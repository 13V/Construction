import Foundation
import UIKit

/**
 The plumbing SiteGeofencePlugin needs when there is no web view to lean on.

 Everything here runs in a process iOS has woken for a few seconds to hand
 over a region crossing. That budget is the constraint: one token refresh,
 one POST, then get out.
 */

/// Credentials for the background path. The refresh token is a worker's
/// long-lived key to their own account, so it goes in the keychain; the rest
/// is configuration and lives in defaults.
enum Store {
    private static let d = UserDefaults.standard

    static var apiBase: String {
        get { d.string(forKey: "cl.apiBase") ?? "" }
        set { d.set(newValue, forKey: "cl.apiBase") }
    }
    static var supabaseUrl: String {
        get { d.string(forKey: "cl.supabaseUrl") ?? "" }
        set { d.set(newValue, forKey: "cl.supabaseUrl") }
    }
    static var anonKey: String {
        get { d.string(forKey: "cl.anonKey") ?? "" }
        set { d.set(newValue, forKey: "cl.anonKey") }
    }
    static var refreshToken: String {
        get { Keychain.read("cl.refreshToken") ?? "" }
        set { Keychain.write("cl.refreshToken", newValue) }
    }
}

enum Keychain {
    private static func query(_ key: String) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: "app.crewline.worker",
            kSecAttrAccount as String: key,
            // The app is woken in the background before first unlock is not a
            // case that happens for region monitoring, but AfterFirstUnlock is
            // the honest accessibility for something read while the screen is
            // off and the phone is in a pocket.
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlock,
        ]
    }

    static func write(_ key: String, _ value: String) {
        var q = query(key)
        SecItemDelete(q as CFDictionary)
        q[kSecValueData as String] = value.data(using: .utf8)
        SecItemAdd(q as CFDictionary, nil)
    }

    static func read(_ key: String) -> String? {
        var q = query(key)
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: AnyObject?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess,
              let data = out as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }
}

enum Api {
    /// Exchange the stored refresh token for an access token, then report the
    /// crossing. Supabase rotates refresh tokens on use, so the new one is
    /// written back — miss that and the next crossing is unauthenticated.
    static func post(lat: Double, lng: Double, entered: Bool, done: @escaping (Bool) -> Void) {
        guard !Store.refreshToken.isEmpty,
              let refreshUrl = URL(string: "\(Store.supabaseUrl)/auth/v1/token?grant_type=refresh_token"),
              let pingUrl = URL(string: "\(Store.apiBase)/api/ping") else {
            done(false)
            return
        }

        var refresh = URLRequest(url: refreshUrl)
        refresh.httpMethod = "POST"
        refresh.setValue("application/json", forHTTPHeaderField: "Content-Type")
        refresh.setValue(Store.anonKey, forHTTPHeaderField: "apikey")
        refresh.httpBody = try? JSONSerialization.data(withJSONObject: ["refresh_token": Store.refreshToken])

        URLSession.shared.dataTask(with: refresh) { data, _, _ in
            guard let data = data,
                  let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let access = json["access_token"] as? String else {
                done(false)
                return
            }
            if let rotated = json["refresh_token"] as? String, !rotated.isEmpty {
                Store.refreshToken = rotated
            }

            var ping = URLRequest(url: pingUrl)
            ping.httpMethod = "POST"
            ping.setValue("application/json", forHTTPHeaderField: "Content-Type")
            ping.setValue("Bearer \(access)", forHTTPHeaderField: "Authorization")
            // A plain ping, deliberately: the server's dwell engine already
            // decides what a position means, and it is the only thing allowed
            // to open or close a shift. This says where the phone is, not what
            // should happen because of it.
            ping.httpBody = try? JSONSerialization.data(withJSONObject: [
                "lat": lat,
                "lng": lng,
                "accuracyM": 50,
                "at": Int(Date().timeIntervalSince1970 * 1000),
                "source": entered ? "region_enter" : "region_exit",
            ])

            URLSession.shared.dataTask(with: ping) { _, response, _ in
                let ok = (response as? HTTPURLResponse).map { (200..<300).contains($0.statusCode) } ?? false
                done(ok)
            }.resume()
        }.resume()
    }
}

/// iOS gives a woken app a short, finite window. Asking for a background task
/// keeps the process alive across the two round trips above instead of being
/// suspended halfway through the refresh.
enum UIApplicationCompat {
    static func beginBackgroundTask() -> UIBackgroundTaskIdentifier {
        UIApplication.shared.beginBackgroundTask(withName: "crewline.region")
    }
    static func endBackgroundTask(_ id: UIBackgroundTaskIdentifier) {
        guard id != .invalid else { return }
        UIApplication.shared.endBackgroundTask(id)
    }
}
