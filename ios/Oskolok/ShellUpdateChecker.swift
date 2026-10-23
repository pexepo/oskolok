import Foundation

/// Reads the public release catalogue (/api/site/releases) and reports an iPhone build newer than this one.
enum ShellUpdateChecker {
    struct Update { let version: String; let changelog: String }
    private struct Catalog: Decodable { let data: Payload }
    private struct Payload: Decodable { let platforms: [Platform] }
    private struct Platform: Decodable { let platform: String; let builds: [Build] }
    private struct Build: Decodable { let version: String; let changelog: String }

    static func check(completion: @escaping (Update?) -> Void) {
        var request = URLRequest(url: URL(string: "https://oskolok.lol/api/site/releases")!)
        request.cachePolicy = .reloadIgnoringLocalCacheData
        request.timeoutInterval = 15
        URLSession.shared.dataTask(with: request) { data, response, _ in
            var result: Update?
            if let data, (response as? HTTPURLResponse)?.statusCode == 200,
               let catalog = try? JSONDecoder().decode(Catalog.self, from: data),
               let build = catalog.data.platforms.first(where: { $0.platform == "ios" })?.builds.first,
               isNewer(build.version, than: Bundle.main.shortVersion) {
                result = Update(version: build.version, changelog: build.changelog)
            }
            DispatchQueue.main.async { completion(result) }
        }.resume()
    }

    /// Numeric comparison: 1.10.0 is newer than 1.9.3.
    static func isNewer(_ candidate: String, than current: String) -> Bool {
        let a = candidate.split(separator: ".").map { Int($0.prefix { $0.isNumber }) ?? 0 }
        let b = current.split(separator: ".").map { Int($0.prefix { $0.isNumber }) ?? 0 }
        for i in 0..<max(a.count, b.count) {
            let x = i < a.count ? a[i] : 0, y = i < b.count ? b[i] : 0
            if x != y { return x > y }
        }
        return false
    }
}
