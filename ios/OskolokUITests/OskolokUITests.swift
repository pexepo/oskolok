import XCTest

/// Runs in the iOS Simulator on CI: the app launches, the web player loads from oskolok.lol and the
/// first screen is captured as an artifact. Simulator only; this is not a test on a physical iPhone.
final class OskolokUITests: XCTestCase {
    func testLaunchShowsThePlayer() throws {
        let app = XCUIApplication()
        app.launch()
        let web = app.webViews.firstMatch
        XCTAssertTrue(web.waitForExistence(timeout: 30), "The web view did not appear")
        // Only the rendered player counts: its Telegram login screen or, when signed in, the main navigation.
        // The static loading placeholder of index.html must not satisfy this check.
        let content = web.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS[c] 'Войдите через Telegram' OR label CONTAINS[c] 'Sign in with Telegram' OR label == 'Главная'")).firstMatch
        let loaded = content.waitForExistence(timeout: 60)
        // The accessibility tree can be ahead of the painted frame; give WebKit a moment to draw.
        sleep(4)
        let first = XCTAttachment(screenshot: app.screenshot())
        first.name = loaded ? "player" : "not-loaded"
        first.lifetime = .keepAlways
        add(first)
        XCTAssertTrue(loaded, "The player UI from oskolok.lol/app did not render")
        XCUIDevice.shared.press(.home)
        app.activate()
        XCTAssertTrue(web.waitForExistence(timeout: 10), "The player did not come back after returning to the app")
    }
}
