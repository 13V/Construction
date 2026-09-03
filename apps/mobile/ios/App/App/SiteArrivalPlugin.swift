import Capacitor
import CoreLocation
import Foundation
import UserNotifications

/**
 Tells a worker they have arrived. Nothing else.

 This is deliberately much less than the plugin it replaces. That one watched
 the same boundaries but reported the crossing to the server itself, in Swift,
 with a refresh token out of the keychain — an app making network calls from
 code no reviewer can see, on behalf of an employer, about an employee's
 location. Whatever the intent, that is what it looked like, and it drew a
 second finding under guideline 5.6.

 So this one has no network access, holds no credentials, and transmits no
 position. It monitors regions and raises a local notification: "You've
 arrived at Glenelg Marina." The worker taps it, the app opens, and they clock
 on themselves — which is the existing, server-checked clock-in that has been
 in the app all along.

 The difference is who the location is for. Nothing here reports a worker to
 anybody; it reminds them to start their own shift so they do not lose an hour
 of pay they earned. That is an ordinary location-based reminder, and the
 worker is the only one who acts on it.

 Region monitoring is watched by iOS itself and needs no UIBackgroundModes
 key. It does need "Always" authorization, because a reminder that only works
 while you are already looking at the app is not a reminder.
 */
@objc(SiteArrivalPlugin)
public class SiteArrivalPlugin: CAPPlugin, CAPBridgedPlugin, CLLocationManagerDelegate {
    public let identifier = "SiteArrivalPlugin"
    public let jsName = "SiteArrival"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "requestPermissions", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setSites", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clear", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "monitored", returnType: CAPPluginReturnPromise),
    ]

    private let manager = CLLocationManager()
    private var permissionCall: CAPPluginCall?

    /// iOS monitors at most 20 regions per app. A company with more open jobs
    /// than that is ordinary, so the nearest 20 win — a site on the other side
    /// of the state is not one this phone is about to walk into.
    private static let maxRegions = 20

    /// Site names, kept only so a notification can say where you are. Names
    /// are not secrets and never leave the device.
    private var names: [String: String] = [:]

    public override func load() {
        manager.delegate = self
        manager.allowsBackgroundLocationUpdates = false
    }

    @objc func requestPermissions(_ call: CAPPluginCall) {
        permissionCall = call
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) { _, _ in
            DispatchQueue.main.async { self.manager.requestAlwaysAuthorization() }
        }
    }

    @objc func setSites(_ call: CAPPluginCall) {
        guard let sites = call.getArray("sites") as? [[String: Any]] else {
            call.reject("sites is required")
            return
        }
        for region in manager.monitoredRegions { manager.stopMonitoring(for: region) }
        names.removeAll()

        let here = manager.location?.coordinate
        let ordered: [[String: Any]] = here == nil ? sites : sites.sorted { distance($0, here!) < distance($1, here!) }

        var started = 0
        for site in ordered.prefix(Self.maxRegions) {
            guard let id = site["id"] as? String,
                  let lat = site["lat"] as? Double,
                  let lng = site["lng"] as? Double else { continue }
            let radius = min((site["radiusM"] as? Double) ?? 100, manager.maximumRegionMonitoringDistance)
            let region = CLCircularRegion(
                center: CLLocationCoordinate2D(latitude: lat, longitude: lng),
                radius: radius,
                identifier: id
            )
            region.notifyOnEntry = true
            region.notifyOnExit = true
            names[id] = (site["name"] as? String) ?? "the site"
            manager.startMonitoring(for: region)
            started += 1
        }
        call.resolve(["monitoring": started])
    }

    @objc func monitored(_ call: CAPPluginCall) {
        call.resolve(["count": manager.monitoredRegions.count])
    }

    @objc func clear(_ call: CAPPluginCall) {
        for region in manager.monitoredRegions { manager.stopMonitoring(for: region) }
        names.removeAll()
        call.resolve()
    }

    private func distance(_ site: [String: Any], _ from: CLLocationCoordinate2D) -> CLLocationDistance {
        guard let lat = site["lat"] as? Double, let lng = site["lng"] as? Double else { return .greatestFiniteMagnitude }
        return CLLocation(latitude: lat, longitude: lng)
            .distance(from: CLLocation(latitude: from.latitude, longitude: from.longitude))
    }

    public func locationManager(_ m: CLLocationManager, didChangeAuthorization status: CLAuthorizationStatus) {
        guard let call = permissionCall else { return }
        permissionCall = nil
        call.resolve(["granted": status == .authorizedAlways])
    }

    public func locationManager(_ m: CLLocationManager, didEnterRegion region: CLRegion) {
        notify(region, arriving: true)
    }

    public func locationManager(_ m: CLLocationManager, didExitRegion region: CLRegion) {
        notify(region, arriving: false)
    }

    /// The whole of what a crossing does. No request, no upload, no position:
    /// a message on this phone, for the person holding it.
    private func notify(_ region: CLRegion, arriving: Bool) {
        let name = names[region.identifier] ?? "the site"
        let content = UNMutableNotificationContent()
        content.title = arriving ? "You're at \(name)" : "You've left \(name)"
        content.body = arriving
            ? "Open Proven to clock on."
            : "Open Proven to clock off if you're finished."
        content.sound = .default
        content.userInfo = ["siteId": region.identifier, "arriving": arriving]

        UNUserNotificationCenter.current().add(
            UNNotificationRequest(identifier: "\(region.identifier)-\(arriving)", content: content, trigger: nil)
        )
        notifyListeners("arrival", data: ["siteId": region.identifier, "arriving": arriving])
    }
}
