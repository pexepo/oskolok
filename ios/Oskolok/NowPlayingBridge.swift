import MediaPlayer
import UIKit

/// Lock screen, Control Center, CarPlay-style remotes and headphone buttons.
/// The page reports what plays through `window.OskolokNative.update(...)` (the same contract as the
/// Android shell); remote commands go back as `window.__oskolokMedia(command, positionMs)`.
/// When WebKit itself provides the Media Session API, the page's own handlers are used and this
/// bridge stays idle, so commands are never delivered twice.
final class NowPlayingBridge {
    static let shared = NowPlayingBridge()
    private(set) var isPlaying = false
    var sendCommand: ((String, Double) -> Void)?
    private var commandsRegistered = false
    private var artworkURL: String?
    private var artwork: MPMediaItemArtwork?

    func update(title: String, artist: String, artworkURL: String, playing: Bool, positionMs: Double, durationMs: Double) {
        registerCommands()
        isPlaying = playing
        var info: [String: Any] = [
            MPMediaItemPropertyTitle: title,
            MPMediaItemPropertyArtist: artist,
            MPNowPlayingInfoPropertyElapsedPlaybackTime: max(0, positionMs / 1000),
            MPNowPlayingInfoPropertyPlaybackRate: playing ? 1.0 : 0.0,
        ]
        if durationMs > 0 { info[MPMediaItemPropertyPlaybackDuration] = durationMs / 1000 }
        if self.artworkURL == artworkURL, let artwork { info[MPMediaItemPropertyArtwork] = artwork }
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
        if #available(iOS 13.0, *) { MPNowPlayingInfoCenter.default().playbackState = playing ? .playing : .paused }
        if self.artworkURL != artworkURL { loadArtwork(artworkURL) }
    }

    func clear() {
        isPlaying = false
        MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
    }

    private func loadArtwork(_ url: String) {
        artworkURL = url
        artwork = nil
        guard let source = URL(string: url), source.scheme == "https" else { return }
        URLSession.shared.dataTask(with: source) { [weak self] data, _, _ in
            guard let self, let data, let image = UIImage(data: data) else { return }
            DispatchQueue.main.async {
                guard self.artworkURL == url else { return }
                let art = MPMediaItemArtwork(boundsSize: image.size) { _ in image }
                self.artwork = art
                var info = MPNowPlayingInfoCenter.default().nowPlayingInfo ?? [:]
                info[MPMediaItemPropertyArtwork] = art
                MPNowPlayingInfoCenter.default().nowPlayingInfo = info
            }
        }.resume()
    }

    private func registerCommands() {
        guard !commandsRegistered else { return }
        commandsRegistered = true
        let center = MPRemoteCommandCenter.shared()
        center.playCommand.addTarget { [weak self] _ in self?.sendCommand?("play", 0); return .success }
        center.pauseCommand.addTarget { [weak self] _ in self?.sendCommand?("pause", 0); return .success }
        center.togglePlayPauseCommand.addTarget { [weak self] _ in
            guard let self else { return .commandFailed }
            self.sendCommand?(self.isPlaying ? "pause" : "play", 0); return .success
        }
        center.nextTrackCommand.addTarget { [weak self] _ in self?.sendCommand?("next", 0); return .success }
        center.previousTrackCommand.addTarget { [weak self] _ in self?.sendCommand?("previous", 0); return .success }
        center.changePlaybackPositionCommand.addTarget { [weak self] event in
            guard let event = event as? MPChangePlaybackPositionCommandEvent else { return .commandFailed }
            self?.sendCommand?("seek", event.positionTime * 1000); return .success
        }
    }
}
