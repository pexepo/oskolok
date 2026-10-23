import UIKit

/// Shown when oskolok.lol cannot be reached. The player needs the network for music anyway.
final class OfflineView: UIView {
    var onRetry: (() -> Void)?

    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = Theme.background
        let logo = UIImageView(image: UIImage(named: "LaunchLogo"))
        logo.contentMode = .scaleAspectFit
        logo.heightAnchor.constraint(equalToConstant: 72).isActive = true
        logo.widthAnchor.constraint(equalToConstant: 72).isActive = true
        let title = UILabel()
        title.text = "Нет соединения с Осколком"
        title.font = .systemFont(ofSize: 20, weight: .semibold)
        title.textColor = Theme.ink
        title.textAlignment = .center
        let text = UILabel()
        text.text = "Проверь интернет и попробуй ещё раз. Коллекция и настройки сохранены на сервере."
        text.font = .systemFont(ofSize: 15)
        text.textColor = Theme.muted
        text.textAlignment = .center
        text.numberOfLines = 0
        let button = UIButton(type: .system)
        button.setTitle("Повторить", for: .normal)
        button.titleLabel?.font = .systemFont(ofSize: 17, weight: .semibold)
        button.setTitleColor(Theme.background, for: .normal)
        button.backgroundColor = Theme.accent
        button.layer.cornerRadius = 24
        button.contentEdgeInsets = UIEdgeInsets(top: 13, left: 30, bottom: 13, right: 30)
        button.addTarget(self, action: #selector(retry), for: .touchUpInside)
        button.accessibilityIdentifier = "offline.retry"
        let stack = UIStackView(arrangedSubviews: [logo, title, text, button])
        stack.axis = .vertical
        stack.alignment = .center
        stack.spacing = 16
        stack.setCustomSpacing(26, after: text)
        stack.translatesAutoresizingMaskIntoConstraints = false
        addSubview(stack)
        NSLayoutConstraint.activate([
            stack.centerYAnchor.constraint(equalTo: safeAreaLayoutGuide.centerYAnchor),
            stack.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 32),
            stack.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -32),
        ])
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }
    @objc private func retry() { onRetry?() }
}
