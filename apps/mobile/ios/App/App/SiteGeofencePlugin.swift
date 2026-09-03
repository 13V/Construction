import Capacitor
import CoreLocation
import Foundation

/**
 A geofence that survives the app being closed, without the location
 background mode.

 App Review rejected 1.0 under guideline 2.5.4: the app declared
 `UIBackgroundModes: location` and the only thing it used persistent location
 for was tracking employees. Region monitoring is a different mechanism —
 iOS itself watches the boundaries and relaunches the app when one is
 crossed — and it needs no background mode at all. The key is gone; this
 file is what replaces it.

 The awkward part, and the reason there is so much Swift here: when a
 boundary is crossed with the app terminated, iOS relaunches it into the
 background and calls this delegate, but the web view is not running and
 JavaScript cannot be relied on to exist. So the crossing has to be reported
 from here, natively, including minting a fresh access token — Supabase
 access tokens last an hour and a crossing at 3pm cannot use one issued at 9.
 The refresh token is what is kept, and it is exchanged at the moment it is
 needed.

 Credentials live in the keychain rather than UserDefaults: this is a
 refresh token for a worker's account, and an app's defaults are readable
 from a backup.

 UNTESTED ON DEVICE at the time of writing. It compiles, and the logic is
 straightforward, but "does a shift open when you drive onto a site" is only
 answerable by walking onto one. Until somebody has, treat the foreground
 watcher as the thing that actually records hours.
 */
@objc(SiteGeofencePlugin)
public class SiteGeofencePlugin: CAPPlugin, CAPBridgedPlugin, CLLocationManagerDelegate {
    public let identifier = "SiteGeofencePlugin"
    public let jsName = "SiteGeofence"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "requestAlways", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setRegions", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setCredentials", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clear", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "monitored", returnType: CAPPluginReturnPromise),
    ]

    private let manager = CLLocationManager()
    private var permissionCall: CAPPluginCall?

    /// iOS monitors at most 20 regions per app. A tiling company with more
    /// open job sites than that is real, so the nearest 20 win rather than an
    /// arbitrary 20 — a site on the other side of the state is not one this
    /// phone is about to walk into.
    private static let maxRegions = 20

    public override func load() {
        manager.delegate = self
        manager.allowsBackgroundLocationUpdates = false
    }

    // MARK: - JS surface

    @objc func requestAlways(_ call: CAPPluginCall) {
        permissionCall = call
        manager.requestAlwaysAuthorization()
    }

    @objc func setCredentials(_ call: CAPPluginCall) {
        guard let apiBase = call.getString("apiBase"),
              let supabaseUrl = call.getString("supabaseUrl"),
              let anonKey = call.getString("anonKey"),
              let refreshToken = call.getString("refreshToken") else {
            call.reject("apiBase, supabaseUrl, anonKey and refreshToken are required")
            return
        }
        Store.apiBase = apiBase
        Store.supabaseUrl = supabaseUrl
        Store.anonKey = anonKey
        Store.refreshToken = refreshToken
        call.resolve()
    }

    @objc func setRegions(_ call: CAPPluginCall) {
        guard let sites = call.getArray("sites") as? [[String: Any]] else {
            call.reject("sites is required")
            return
        }
        for region in manager.monitoredRegions { manager.stopMonitoring(for: region) }

        let here = manager.location?.coordinate
        let sorted: [[String: Any]] = here == nil ? sites : sites.sorted { a, b in
            distance(a, here!) < distance(b, here!)
        }

        var started = 0
        for site in sorted.prefix(Self.maxRegions) {
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
            manager.startMonitoring(for: region)
            started += 1
        }
        call.resolve(["monitoring": started])
    }

    @objc func monitored(_ call: CAPPluginCall) {
        call.resolve(["count": manager.monitoredRegions.count,
                      "ids": manager.monitoredRegions.map { $0.identifier }])
    }

    @objc func clear(_ call: CAPPluginCall) {
        for region in manager.monitoredRegions { manager.stopMonitoring(for: region) }
        call.resolve()
    }

    private func distance(_ site: [String: Any], _ from: CLLocationCoordinate2D) -> CLLocationDistance {
        guard let lat = site["lat"] as? Double, let lng = site["lng"] as? Double else { return .greatestFiniteMagnitude }
        return CLLocation(latitude: lat, longitude: lng)
            .distance(from: CLLocation(latitude: from.latitude, longitude: from.longitude))
    }

    // MARK: - Delegate

    public func locationManager(_ m: CLLocationManager, didChangeAuthorization status: CLAuthorizationStatus) {
        guard let call = permissionCall else { return }
        permissionCall = nil
        call.resolve(["granted": status == .authorizedAlways, "status": status.rawValue])
    }

    public func locationManager(_ m: CLLocationManager, didEnterRegion region: CLRegion) {
        report(region: region, entered: true)
    }

    public func locationManager(_ m: CLLocationManager, didExitRegion region: CLRegion) {
        report(region: region, entered: false)
    }

    /// A crossing has to reach the server whether or not the web view exists,
    /// so it is posted from here. `notifyListeners` is a courtesy for the case
    /// where JavaScript happens to be alive and wants to redraw.
    private func report(region: CLRegion, entered: Bool) {
        guard let circular = region as? CLCircularRegion else { return }
        notifyListeners("crossing", data: ["siteId": region.identifier, "entered": entered])

        let task = UIApplicationCompat.beginBackgroundTask()
        Api.post(
            lat: circular.center.latitude,
            lng: circular.center.longitude,
            entered: entered
        ) { _ in
            UIApplicationCompat.endBackgroundTask(task)
        }
    }
}
