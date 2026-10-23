import UIKit
import AVFoundation

@main
final class AppDelegate: UIResponder, UIApplicationDelegate {
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        AudioSessionController.shared.configure()
        return true
    }

    func application(_ application: UIApplication, configurationForConnecting connectingSceneSession: UISceneSession, options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        UISceneConfiguration(name: "Default", sessionRole: connectingSceneSession.role)
    }
}

final class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }
        let window = UIWindow(windowScene: windowScene)
        window.backgroundColor = Theme.background
        let controller = PlayerViewController()
        // A tapped oskolok.lol link (Universal Link or custom scheme) opens that page inside the app.
        if let url = connectionOptions.urlContexts.first?.url { controller.pendingURL = Site.internalURL(from: url) }
        window.rootViewController = controller
        window.makeKeyAndVisible()
        self.window = window
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        guard let url = URLContexts.first?.url, let target = Site.internalURL(from: url) else { return }
        (window?.rootViewController as? PlayerViewController)?.open(target)
    }

    func sceneDidBecomeActive(_ scene: UIScene) {
        AudioSessionController.shared.activateIfNeeded()
        (window?.rootViewController as? PlayerViewController)?.checkForShellUpdate()
    }
}

enum Theme {
    static let background = UIColor(red: 0.031, green: 0.055, blue: 0.106, alpha: 1)
    static let ink = UIColor(red: 0.91, green: 0.94, blue: 1, alpha: 1)
    static let muted = UIColor(red: 0.71, green: 0.77, blue: 0.87, alpha: 1)
    static let accent = UIColor(red: 0.5, green: 0.71, blue: 1, alpha: 1)
}

enum Site {
    static let origin = URL(string: "https://oskolok.lol")!
    static let app = URL(string: "https://oskolok.lol/app")!
    static let host = "oskolok.lol"

    static func isOwn(_ url: URL) -> Bool { url.scheme == "https" && url.host == host }

    /** oskolok://path and https://oskolok.lol/path both open inside the app; nothing else does. */
    static func internalURL(from url: URL) -> URL? {
        if isOwn(url) { return url }
        guard url.scheme == "oskolok" else { return nil }
        var components = URLComponents(url: origin, resolvingAgainstBaseURL: false)
        components?.path = "/" + [url.host, url.path].compactMap { $0 }.joined().trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        components?.query = url.query
        return components?.url
    }
}
