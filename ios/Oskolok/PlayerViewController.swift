import UIKit
import WebKit

/// The whole Осколок player in a WKWebView: the same code as the site, so features arrive without
/// reinstalling. Native parts: audio session, lock-screen controls, safe areas, offline screen,
/// external links and the check for a newer shell build.
final class PlayerViewController: UIViewController, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
    var pendingURL: URL?
    private var webView: WKWebView!
    private let offline = OfflineView()
    private var darkContent = true
    private var lastUpdateCheck: Date?

    override var preferredStatusBarStyle: UIStatusBarStyle { darkContent ? .lightContent : .darkContent }

    override func loadView() {
        let configuration = WKWebViewConfiguration()
        configuration.allowsInlineMediaPlayback = true
        configuration.mediaTypesRequiringUserActionForPlayback = []
        configuration.allowsAirPlayForMediaPlayback = true
        configuration.websiteDataStore = .default()
        configuration.applicationNameForUserAgent = "OskolokIOS/\(Bundle.main.shortVersion)"
        let controller = WKUserContentController()
        controller.add(WeakScriptHandler(self), name: "oskolok")
        // Same contract as the Android shell (src/utils/nativeShell.ts, AudioManager.reportNative).
        // setTheme is always available; update/clear only when WebKit has no Media Session API,
        // so lock-screen commands are handled once (by the page itself when it can).
        // The site and the login screen are always dark, whatever theme the player reports.
        let bridge = """
        (function(){
          var post = function(m){ try { window.webkit.messageHandlers.oskolok.postMessage(m); } catch (e) {} };
          var wanted = true, sent = null;
          var forcedDark = function(){ var h = document.documentElement; return h.classList.contains('site-mode') || !!document.querySelector('main.login-stage'); };
          var report = function(){ var dark = forcedDark() || wanted; if (dark !== sent) { sent = dark; post({type:'theme', dark: dark}); } };
          var api = { setTheme: function(d){ wanted = !!d; report(); } };
          if (!('mediaSession' in navigator)) {
            api.update = function(t,a,art,p,pos,dur){ post({type:'update',title:String(t),artist:String(a),artwork:String(art||''),playing:!!p,position:+pos||0,duration:+dur||0}); };
            api.clear = function(){ post({type:'clear'}); };
          }
          window.OskolokNative = api;
          document.addEventListener('DOMContentLoaded', report);
          setInterval(report, 1000);
        })();
        """
        controller.addUserScript(WKUserScript(source: bridge, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        configuration.userContentController = controller

        webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = true
        webView.isOpaque = false
        webView.backgroundColor = Theme.background
        webView.scrollView.backgroundColor = Theme.background
        // The page pads itself with env(safe-area-inset-*) (viewport-fit=cover).
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.scrollView.bounces = false
        if #available(iOS 16.4, *) { webView.isInspectable = false }

        let root = UIView()
        root.backgroundColor = Theme.background
        webView.translatesAutoresizingMaskIntoConstraints = false
        offline.translatesAutoresizingMaskIntoConstraints = false
        offline.isHidden = true
        offline.onRetry = { [weak self] in self?.reload() }
        root.addSubview(webView)
        root.addSubview(offline)
        NSLayoutConstraint.activate([
            webView.topAnchor.constraint(equalTo: root.topAnchor), webView.bottomAnchor.constraint(equalTo: root.bottomAnchor),
            webView.leadingAnchor.constraint(equalTo: root.leadingAnchor), webView.trailingAnchor.constraint(equalTo: root.trailingAnchor),
            offline.topAnchor.constraint(equalTo: root.topAnchor), offline.bottomAnchor.constraint(equalTo: root.bottomAnchor),
            offline.leadingAnchor.constraint(equalTo: root.leadingAnchor), offline.trailingAnchor.constraint(equalTo: root.trailingAnchor),
        ])
        view = root

        let send: (String, Double) -> Void = { [weak self] command, position in self?.deliver(command, position) }
        AudioSessionController.shared.sendCommand = send
        NowPlayingBridge.shared.sendCommand = send
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        webView.load(URLRequest(url: pendingURL ?? Site.app))
        pendingURL = nil
    }

    func open(_ url: URL) { webView.load(URLRequest(url: url)) }

    private func reload() {
        offline.isHidden = true
        if let current = webView.url, Site.isOwn(current) { webView.reload() } else { webView.load(URLRequest(url: Site.app)) }
    }

    /// Commands from the lock screen, headphones or an audio interruption, delivered to the page's player.
    private func deliver(_ command: String, _ positionMs: Double) {
        guard ["play", "pause", "next", "previous", "seek"].contains(command), let url = webView.url, Site.isOwn(url) else { return }
        let position = positionMs.isFinite ? Int(positionMs) : 0
        webView.evaluateJavaScript("window.__oskolokMedia&&window.__oskolokMedia('\(command)',\(position))", completionHandler: nil)
    }

    // MARK: Messages from the page

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame, Site.isOwn(message.frameInfo.request.url ?? webView.url ?? Site.origin), let body = message.body as? [String: Any], let type = body["type"] as? String else { return }
        switch type {
        case "update":
            NowPlayingBridge.shared.update(title: body["title"] as? String ?? "", artist: body["artist"] as? String ?? "", artworkURL: body["artwork"] as? String ?? "", playing: body["playing"] as? Bool ?? false, positionMs: body["position"] as? Double ?? 0, durationMs: body["duration"] as? Double ?? 0)
        case "clear":
            NowPlayingBridge.shared.clear()
        case "theme":
            let dark = body["dark"] as? Bool ?? true
            if dark != darkContent { darkContent = dark; setNeedsStatusBarAppearanceUpdate() }
        default: break
        }
    }

    // MARK: Navigation

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else { decisionHandler(.cancel); return }
        if Site.isOwn(url) || url.scheme == "about" || url.scheme == "blob" || url.scheme == "data" { decisionHandler(.allow); return }
        // Telegram, music services, downloads and everything else open outside the app.
        if navigationAction.targetFrame?.isMainFrame ?? true, ["http", "https", "tg", "mailto"].contains(url.scheme ?? "") { UIApplication.shared.open(url) }
        decisionHandler(.cancel)
    }

    /// target=_blank links: own pages stay inside, the rest opens in Safari or Telegram.
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url {
            if Site.isOwn(url) { webView.load(navigationAction.request) } else { UIApplication.shared.open(url) }
        }
        return nil
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { offline.isHidden = true }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { showOfflineIfNeeded(error) }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { showOfflineIfNeeded(error) }
    /// iOS may end the page's process in the background; reload instead of showing a blank screen.
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { reload() }

    private func showOfflineIfNeeded(_ error: Error) {
        let code = (error as NSError).code
        if code == NSURLErrorCancelled || code == 102 /* frame load interrupted by policy */ { return }
        offline.isHidden = false
    }

    // MARK: JavaScript dialogs (confirm/alert in the page)

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler() })
        present(alert, animated: true)
    }
    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "Отмена", style: .cancel) { _ in completionHandler(false) })
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler(true) })
        present(alert, animated: true)
    }

    // MARK: Shell updates

    /// Asks the release catalogue whether a newer iPhone build exists. The web content updates by itself;
    /// this is only about the installed shell, which needs a manual reinstall with the chosen method.
    func checkForShellUpdate() {
        if let last = lastUpdateCheck, Date().timeIntervalSince(last) < 6 * 3600 { return }
        lastUpdateCheck = Date()
        ShellUpdateChecker.check { [weak self] update in
            guard let self, let update, self.presentedViewController == nil else { return }
            let key = "oskolok.dismissedShellVersion"
            if UserDefaults.standard.string(forKey: key) == update.version { return }
            let alert = UIAlertController(title: "Новая версия приложения \(update.version)", message: update.changelog.isEmpty ? "Вышла новая сборка Осколка для iPhone." : update.changelog, preferredStyle: .alert)
            alert.addAction(UIAlertAction(title: "Позже", style: .cancel) { _ in UserDefaults.standard.set(update.version, forKey: key) })
            alert.addAction(UIAlertAction(title: "Как обновить", style: .default) { [weak self] _ in self?.open(URL(string: "https://oskolok.lol/download/ios")!) })
            self.present(alert, animated: true)
        }
    }
}

/// WKUserContentController retains its handlers; this breaks the cycle with the view controller.
private final class WeakScriptHandler: NSObject, WKScriptMessageHandler {
    weak var target: WKScriptMessageHandler?
    init(_ target: WKScriptMessageHandler) { self.target = target }
    func userContentController(_ c: WKUserContentController, didReceive message: WKScriptMessage) { target?.userContentController(c, didReceive: message) }
}

extension Bundle {
    var shortVersion: String { infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.0" }
}
