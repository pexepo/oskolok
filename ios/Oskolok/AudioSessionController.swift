import AVFoundation
import UIKit

/// Music keeps playing with the screen locked or the app in the background: the session is `.playback`,
/// and `UIBackgroundModes` contains `audio`. Interruptions (calls, Siri, other apps) and unplugged
/// headphones pause the page's player through the same bridge as the lock-screen buttons.
final class AudioSessionController {
    static let shared = AudioSessionController()
    /// Delivers `play`, `pause` etc. to the page (`window.__oskolokMedia`). Set by the player view.
    var sendCommand: ((String, Double) -> Void)?
    private var resumeAfterInterruption = false

    func configure() {
        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(.playback, mode: .default, policy: .longFormAudio, options: [])
        } catch {
            try? session.setCategory(.playback, mode: .default, options: [])
        }
        let center = NotificationCenter.default
        center.addObserver(self, selector: #selector(interrupted(_:)), name: AVAudioSession.interruptionNotification, object: session)
        center.addObserver(self, selector: #selector(routeChanged(_:)), name: AVAudioSession.routeChangeNotification, object: session)
        center.addObserver(self, selector: #selector(mediaServicesReset), name: AVAudioSession.mediaServicesWereResetNotification, object: session)
    }

    func activateIfNeeded() { try? AVAudioSession.sharedInstance().setActive(true) }

    @objc private func interrupted(_ note: Notification) {
        guard let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt, let type = AVAudioSession.InterruptionType(rawValue: raw) else { return }
        switch type {
        case .began:
            resumeAfterInterruption = NowPlayingBridge.shared.isPlaying
            DispatchQueue.main.async { self.sendCommand?("pause", 0) }
        case .ended:
            let options = (note.userInfo?[AVAudioSessionInterruptionOptionKey] as? UInt).map(AVAudioSession.InterruptionOptions.init(rawValue:)) ?? []
            if resumeAfterInterruption && options.contains(.shouldResume) {
                activateIfNeeded()
                DispatchQueue.main.async { self.sendCommand?("play", 0) }
            }
            resumeAfterInterruption = false
        @unknown default: break
        }
    }

    @objc private func routeChanged(_ note: Notification) {
        guard let raw = note.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt, let reason = AVAudioSession.RouteChangeReason(rawValue: raw) else { return }
        // Headphones pulled out: pause instead of suddenly playing through the speaker.
        if reason == .oldDeviceUnavailable { DispatchQueue.main.async { self.sendCommand?("pause", 0) } }
    }

    @objc private func mediaServicesReset() { configure(); activateIfNeeded() }
}
