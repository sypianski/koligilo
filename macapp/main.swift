// koligilo.app — natywna nakładka na panel koligilo dla macOS.
//
// Uruchamia wbudowaną binarkę Go (Contents/Resources/koligilo --no-browser),
// pokazuje panel w oknie WKWebView i zostaje w pasku menu po zamknięciu okna:
// wtedy komputer dalej odpowiada czytnikom (tryb „komputer jako serwer”,
// discovery UDP). Logika panelu jest w Go i web/ — tu tylko okno i proces.
//
// Budowanie: scripts/mac-app.sh (na Macu).

import AppKit
import ServiceManagement
import WebKit

let panelPort = 47471
let panelURL = URL(string: "http://127.0.0.1:\(panelPort)/")!

// MARK: - proces panelu

final class PanelProcess: @unchecked Sendable { // używana tylko z wątku głównego
    private var proc: Process?
    private(set) var ownsProcess = false
    var onExit: ((Int32) -> Void)?

    var logURL: URL {
        let dir = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Logs/koligilo", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent("panel.log")
    }

    /// Czy panel już odpowiada (np. uruchomiony z terminala) — wtedy go nie dublujemy.
    static func isUp() async -> Bool {
        var req = URLRequest(url: panelURL.appendingPathComponent("api/local/config"), timeoutInterval: 1)
        req.setValue("1", forHTTPHeaderField: "X-Koligilo") // wymóg guard() w desktop.go
        guard let (_, resp) = try? await URLSession.shared.data(for: req) else { return false }
        return (resp as? HTTPURLResponse)?.statusCode == 200
    }

    func start() async throws {
        if await Self.isUp() { return }
        guard let bin = Bundle.main.url(forResource: "koligilo", withExtension: nil) else {
            throw NSError(domain: "koligilo", code: 1, userInfo: [NSLocalizedDescriptionKey: "Brak binarki koligilo w pakiecie aplikacji."])
        }
        let p = Process()
        p.executableURL = bin
        p.arguments = ["--no-browser", "--port", String(panelPort)]
        FileManager.default.createFile(atPath: logURL.path, contents: nil)
        let log = try FileHandle(forWritingTo: logURL)
        log.seekToEndOfFile()
        p.standardOutput = log
        p.standardError = log
        p.terminationHandler = { [weak self] pr in
            DispatchQueue.main.async { self?.ownsProcess = false; self?.onExit?(pr.terminationStatus) }
        }
        try p.run()
        proc = p
        ownsProcess = true
        for _ in 0..<60 { // pierwsze uruchomienie bywa wolne (Gatekeeper)
            if await Self.isUp() { return }
            if !p.isRunning { break }
            try await Task.sleep(nanoseconds: 250_000_000)
        }
        if await Self.isUp() { return }
        throw NSError(domain: "koligilo", code: 2, userInfo: [NSLocalizedDescriptionKey:
            "Panel koligilo nie wystartował. Szczegóły w \(logURL.path)."])
    }

    func stop() {
        guard let p = proc, p.isRunning else { return }
        p.terminationHandler = nil
        p.terminate() // SIGTERM — serwer Go zapisuje stan atomowo, więc to bezpieczne
        p.waitUntilExit()
    }
}

// MARK: - przeciąganie okna (TASK-17)
//
// WebKit na macOS nie zna -webkit-app-region, więc WKWebView (jako contentView
// na całą powierzchnię, przez fullSizeContentView) połyka wszystkie zdarzenia
// myszy — okna nie da się przeciągnąć za to, co wygląda jak pasek tytułu.
// Dwa uzupełniające się mechanizmy:
//  1. wąski, przezroczysty pasek nad WKWebView (sam obsługuje drag przez
//     mouseDownCanMoveWindow — najpewniejszy sposób, bo bez żadnego JS);
//  2. WKScriptMessageHandler: strona JS-em zgłasza mousedown na elementach
//     [data-drag] (patrz web/app.js), a Swift woła performDrag na bieżącym
//     zdarzeniu — pokrywa puste miejsca w pasku bocznym/nagłówku poza paskiem.
// Podwójny klik w obu ścieżkach idzie do wspólnej funkcji niżej.

/// Odwzorowuje systemowe zachowanie podwójnego kliku w tytuł okna (Ustawienia > Pulpit i Dock).
func performTitlebarDoubleClickAction(_ window: NSWindow) {
    switch UserDefaults.standard.string(forKey: "AppleActionOnDoubleClick") {
    case "Minimize": window.performMiniaturize(nil)
    case "None": break
    default: window.performZoom(nil) // domyślne w macOS: "Powiększ"
    }
}

/// Przezroczysty pasek u góry okna — jedyne zadanie to przeciąganie/zoom, reszta (rysowanie,
/// treść) zostaje w WKWebView pod spodem. Wysokość dobrana pod rząd przycisków semaforów.
final class DragStripView: NSView {
    override var mouseDownCanMoveWindow: Bool { true }

    override func mouseDown(with event: NSEvent) {
        if event.clickCount >= 2, let win = window {
            performTitlebarDoubleClickAction(win)
        } else {
            super.mouseDown(with: event) // mouseDownCanMoveWindow == true => AppKit sam przesuwa okno
        }
    }
}

let dragStripHeight: CGFloat = 28

// MARK: - okno panelu

final class PanelWindow: NSWindowController, WKUIDelegate, WKNavigationDelegate, WKDownloadDelegate,
                          WKScriptMessageHandler, NSWindowDelegate {
    let web: WKWebView
    var onClose: (() -> Void)?

    init() {
        let cfg = WKWebViewConfiguration()
        cfg.websiteDataStore = .default() // localStorage (motyw, token trybu serwera) przeżywa restart
        web = WKWebView(frame: .zero, configuration: cfg)
        let contentSize = NSSize(width: 1180, height: 780)
        let win = NSWindow(contentRect: NSRect(origin: .zero, size: contentSize),
                           styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
                           backing: .buffered, defer: false)
        win.title = "koligilo" // zostaje dla Mission Control / menu Okno
        win.titleVisibility = .hidden // ...ale nie rysuje się w pasku tytułu — .brand w web/index.html pokazuje nazwę raz
        win.titlebarAppearsTransparent = true
        win.minSize = NSSize(width: 720, height: 480)
        win.setFrameAutosaveName("koligilo.panel")

        // WKWebView wypełnia okno tak jak wcześniej; pasek przeciągania leży nad nim.
        let container = NSView(frame: NSRect(origin: .zero, size: contentSize))
        web.frame = container.bounds
        web.autoresizingMask = [.width, .height]
        container.addSubview(web)
        let strip = DragStripView(frame: NSRect(x: 0, y: container.bounds.height - dragStripHeight,
                                                 width: container.bounds.width, height: dragStripHeight))
        strip.autoresizingMask = [.width, .minYMargin]
        container.addSubview(strip)
        win.contentView = container
        win.center()
        super.init(window: win)
        win.delegate = self
        web.uiDelegate = self
        web.navigationDelegate = self
        web.allowsBackForwardNavigationGestures = false

        cfg.userContentController.add(self, name: "drag")
        cfg.userContentController.addUserScript(WKUserScript(
            source: Self.dragBridgeScript, injectionTime: .atDocumentStart, forMainFrameOnly: true))
    }

    required init?(coder: NSCoder) { fatalError() }

    // Oznacza <html> klasą "mac-app" (web/style.css dorzuca odstęp na semafory nad .brand)
    // i przekazuje mousedown na pustych obszarach [data-drag] (web/index.html, app.js) do performDrag.
    private static let dragBridgeScript = """
    document.documentElement.classList.add('mac-app');
    document.addEventListener('mousedown', function (e) {
      if (e.button !== 0) return;
      if (!e.target.closest('[data-drag]')) return;
      if (e.target.closest('button, a, input, select, textarea, label, [contenteditable]')) return;
      window.webkit.messageHandlers.drag.postMessage(e.detail >= 2 ? 'dblclick' : 'drag');
    }, true);
    """

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "drag", let win = window else { return }
        if (message.body as? String) == "dblclick" {
            performTitlebarDoubleClickAction(win)
        } else if let ev = NSApp.currentEvent, ev.type == .leftMouseDown {
            win.performDrag(with: ev)
        }
    }

    func load() { web.load(URLRequest(url: panelURL)) }

    func windowWillClose(_ notification: Notification) {
        // userContentController trzyma self silnie (WKScriptMessageHandler) — bez tego
        // PanelWindow nigdy by się nie zwolniło (cykl retencji: PanelWindow -> web -> ... -> self).
        web.configuration.userContentController.removeScriptMessageHandler(forName: "drag")
        onClose?()
    }

    // Linki zewnętrzne (Dropbox, GitHub): target=_blank i window.open → przeglądarka.
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let u = navigationAction.request.url { NSWorkspace.shared.open(u) }
        return nil
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if navigationAction.shouldPerformDownload { return decisionHandler(.download) }
        if let u = navigationAction.request.url, let host = u.host,
           !["127.0.0.1", "localhost"].contains(host), u.scheme?.hasPrefix("http") == true {
            NSWorkspace.shared.open(u) // panel nie opuszcza okna aplikacji
            return decisionHandler(.cancel)
        }
        decisionHandler(.allow)
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse,
                 decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        decisionHandler(navigationResponse.canShowMIMEType ? .allow : .download)
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { retryLater() }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { retryLater() }
    private func retryLater() {
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { [weak self] in self?.load() }
    }

    // Pobieranie (kopia danych: blob + <a download>).
    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) { download.delegate = self }
    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) { download.delegate = self }

    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse,
                  suggestedFilename: String, completionHandler: @escaping (URL?) -> Void) {
        let panel = NSSavePanel()
        panel.nameFieldStringValue = suggestedFilename
        panel.directoryURL = FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask).first
        panel.beginSheetModal(for: window!) { resp in
            guard resp == .OK, let u = panel.url else { return completionHandler(nil) }
            try? FileManager.default.removeItem(at: u) // NSSavePanel już zapytał o nadpisanie
            completionHandler(u)
        }
    }

    // Okienka JS: confirm / alert / prompt (panel używa ich przy usuwaniu i zmianie nazwy).
    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let a = alert(message)
        a.addButton(withTitle: "OK")
        a.beginSheetModal(for: window!) { _ in completionHandler() }
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let a = alert(message)
        a.addButton(withTitle: "OK")
        a.addButton(withTitle: "Anuluj")
        a.beginSheetModal(for: window!) { completionHandler($0 == .alertFirstButtonReturn) }
    }

    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (String?) -> Void) {
        let a = alert(prompt)
        let field = NSTextField(frame: NSRect(x: 0, y: 0, width: 320, height: 24))
        field.stringValue = defaultText ?? ""
        a.accessoryView = field
        a.addButton(withTitle: "OK")
        a.addButton(withTitle: "Anuluj")
        a.window.initialFirstResponder = field
        a.beginSheetModal(for: window!) { completionHandler($0 == .alertFirstButtonReturn ? field.stringValue : nil) }
    }

    private func alert(_ text: String) -> NSAlert {
        let a = NSAlert()
        a.messageText = "koligilo"
        a.informativeText = text
        return a
    }

    // <input type=file> (ZIP wtyczki, import kopii danych).
    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.canChooseDirectories = parameters.allowsDirectories
        panel.canChooseFiles = true
        panel.beginSheetModal(for: window!) { completionHandler($0 == .OK ? panel.urls : nil) }
    }
}

// MARK: - aplikacja

final class AppDelegate: NSObject, NSApplicationDelegate, NSMenuDelegate {
    let panel = PanelProcess()
    var status: NSStatusItem!
    var window: PanelWindow?
    var stateItem: NSMenuItem!
    var loginItem: NSMenuItem!
    var failure: String?

    func applicationDidFinishLaunching(_ n: Notification) {
        buildMainMenu()
        buildStatusItem()
        panel.onExit = { [weak self] code in
            self?.failure = "Panel zatrzymał się (kod \(code))."
            self?.refreshMenu()
        }
        Task { @MainActor in
            do { try await panel.start(); failure = nil }
            catch { failure = error.localizedDescription }
            refreshMenu()
            if let f = failure { showError(f) } else { showWindow() }
        }
    }

    func applicationWillTerminate(_ n: Notification) { panel.stop() }

    // Kliknięcie w ikonę w Docku / ponowne otwarcie aplikacji → okno.
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        showWindow()
        return true
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }

    @objc func showWindow() {
        if window == nil {
            let w = PanelWindow()
            w.onClose = { [weak self] in
                // bez okna: tylko ikona w pasku menu, bez ikony w Docku
                NSApp.setActivationPolicy(.accessory)
                self?.window = nil
            }
            w.load()
            window = w
        }
        NSApp.setActivationPolicy(.regular)
        window?.showWindow(nil)
        window?.window?.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    @objc func openInBrowser() { NSWorkspace.shared.open(panelURL) }

    @objc func restartPanel() {
        panel.stop()
        Task { @MainActor in
            do { try await panel.start(); failure = nil; window?.load() }
            catch { failure = error.localizedDescription; showError(error.localizedDescription) }
            refreshMenu()
        }
    }

    @objc func showLog() { NSWorkspace.shared.open(panel.logURL) }

    @objc func toggleLogin() {
        do {
            if SMAppService.mainApp.status == .enabled { try SMAppService.mainApp.unregister() }
            else { try SMAppService.mainApp.register() }
        } catch {
            showError("Nie udało się zmienić uruchamiania przy logowaniu: \(error.localizedDescription)\n\nNajpewniej działa, gdy koligilo.app leży w folderze Aplikacje.")
        }
        refreshMenu()
    }

    private func showError(_ text: String) {
        let a = NSAlert()
        a.alertStyle = .warning
        a.messageText = "koligilo"
        a.informativeText = text
        a.addButton(withTitle: "OK")
        a.addButton(withTitle: "Pokaż log")
        NSApp.activate(ignoringOtherApps: true)
        if a.runModal() == .alertSecondButtonReturn { showLog() }
    }

    private func buildStatusItem() {
        status = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        let img = NSImage(systemSymbolName: "arrow.triangle.2.circlepath", accessibilityDescription: "koligilo")
        img?.isTemplate = true
        status.button?.image = img
        let m = NSMenu()
        m.delegate = self
        stateItem = NSMenuItem(title: "", action: nil, keyEquivalent: "")
        stateItem.isEnabled = false
        m.addItem(stateItem)
        m.addItem(.separator())
        m.addItem(withTitle: "Otwórz panel", action: #selector(showWindow), keyEquivalent: "o")
        m.addItem(withTitle: "Otwórz w przeglądarce", action: #selector(openInBrowser), keyEquivalent: "")
        m.addItem(.separator())
        loginItem = NSMenuItem(title: "Uruchamiaj przy logowaniu", action: #selector(toggleLogin), keyEquivalent: "")
        m.addItem(loginItem)
        m.addItem(withTitle: "Uruchom panel ponownie", action: #selector(restartPanel), keyEquivalent: "")
        m.addItem(withTitle: "Pokaż log", action: #selector(showLog), keyEquivalent: "")
        m.addItem(.separator())
        m.addItem(withTitle: "Zakończ koligilo", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        for i in m.items where i.action != nil && i.action != #selector(NSApplication.terminate(_:)) { i.target = self }
        status.menu = m
        refreshMenu()
    }

    func menuWillOpen(_ menu: NSMenu) { refreshMenu() }

    private func refreshMenu() {
        let v = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "?"
        if let f = failure {
            stateItem?.title = "⚠︎ " + f
        } else {
            stateItem?.title = "koligilo \(v) — " + (panel.ownsProcess ? "panel działa" : "panel uruchomiony gdzie indziej")
        }
        loginItem?.state = SMAppService.mainApp.status == .enabled ? .on : .off
    }

    // Menu aplikacji z Edycją — bez niego ⌘C/⌘V/⌘A nie działają w polach panelu.
    private func buildMainMenu() {
        let main = NSMenu()
        let appItem = NSMenuItem()
        let app = NSMenu()
        app.addItem(withTitle: "O koligilo", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        app.addItem(.separator())
        app.addItem(withTitle: "Ukryj koligilo", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        app.addItem(withTitle: "Zakończ koligilo", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = app
        main.addItem(appItem)

        let editItem = NSMenuItem()
        let edit = NSMenu(title: "Edycja")
        edit.addItem(withTitle: "Cofnij", action: Selector(("undo:")), keyEquivalent: "z")
        edit.addItem(withTitle: "Powtórz", action: Selector(("redo:")), keyEquivalent: "Z")
        edit.addItem(.separator())
        edit.addItem(withTitle: "Wytnij", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        edit.addItem(withTitle: "Kopiuj", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        edit.addItem(withTitle: "Wklej", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        edit.addItem(withTitle: "Zaznacz wszystko", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        editItem.submenu = edit
        main.addItem(editItem)

        let winItem = NSMenuItem()
        let win = NSMenu(title: "Okno")
        win.addItem(withTitle: "Zamknij okno", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        win.addItem(withTitle: "Minimalizuj", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        win.addItem(withTitle: "Odśwież panel", action: #selector(reloadPanel), keyEquivalent: "r").target = self
        winItem.submenu = win
        main.addItem(winItem)
        NSApp.mainMenu = main
    }

    @objc func reloadPanel() { window?.web.reload() }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
