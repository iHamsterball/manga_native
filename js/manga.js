class Base {
    constructor() {
        // Wasm api
        this.api = {
            // Image processing Section
            analyse: module.cwrap('analyse', 'number', ['string']),
            rotate: module.cwrap('rotate', 'number', ['array', 'number']),
            version: module.cwrap('version', '', []),

            // ePub processing Section
            epub_open: module.cwrap('epub_open', 'number', ['string']),
            epub_count: module.cwrap('epub_count', '', []),
            epub_format: module.cwrap('epub_format', 'string', ['number']),
            // epub_bundle: module.cwrap('epub_bundle', '', []),
            // epub_image: module.cwrap('epub_image', 'number', ['number'])
        };
        // Preloaded files
        this.cache = new Map();
        // WebRTC Host
        this.client = false;
        // Current page & offset
        this.cur = this._offset = 0;
        // IndexedDB
        this.db = null;
        // File list
        this.files = new Array();
        // Prefetch limit
        this.limit = 4;
        // Right-to-Left Order (Left-to-Right -1)
        this.ltr = -1;
        // Messagebox timer
        this.message = null;
        // Meta data
        this.meta = null;
        // Wasm module
        this.module = module;
        // Observer
        this.observer = { 'image': null, 'step': null };
        // Enum image container
        this.pos = Object.freeze({
            primary: Symbol('primary'),
            secondary: Symbol('secondary')
        });
        // PSD library
        this.psd = require('psd');
        // Scale ratio
        this.ratio = 1;
        // Rotate switch
        this.rotate_flags = Object.freeze({
            default: -1,
            rotate_90_clockwise: 0,
            rotate_180: 1,
            rotate_90_counterclockwise: 2
        });
        this.rotate = this.rotate_flags.default;
        // Scale ratio history
        this.scale = [1];
        // Page step
        this.step = 2;
        // Theme
        this.theme = localStorage.getItem('theme') | (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);;
        // Title
        this.title = { 'episode': '', 'manga': '' }
        // Enum type
        this.type = type.undefined;
        // Vertical mode
        this.vertical = false;
        // Viewport
        this.viewport = new Map();
        // WebRTC signaling
        this.signaling = signaling;
        this.signaling.bugout.on('seen', this._webrtc_signaling_peer_connection_callback.bind(this));
        this.signaling.bugout.on('message', this._webrtc_signaling_peer_message_callback.bind(this));
        this.signaling.bugout.on('connections', this._webrtc_signaling_connections_callback.bind(this));
        // WebRTC submodule
        this.webrtc = webrtc;
        this.webrtc.pc.onnegotiationneeded = this._webrtc_negotiation_needed_callback.bind(this);
        this.webrtc.pc.onconnectionstatechange = this._webrtc_connect_callback.bind(this);
        this.webrtc.pc.ondatachannel = this._webrtc_dc_callback.bind(this);
        this.webrtc.ctrl.onmessage = this._webrtc_control_callback.bind(this);

        this._init_indexeddb();
        this._init_observer();
        this._observe_step();
        this._read_setting();
        this._set_version();
    }

    get offset() {
        if (this.rotate == this.rotate_flags.default) return this._offset
        else return 0;
    }

    set offset(value) {
        this._offset = value;
    }

    get primary() {
        return this.cur - this.offset;
    }

    get secondary() {
        return this.cur - this.offset + 1;
    }

    get settings() {
        return {
            offset: this.offset,
            rtl: this.rtl,
            single: this.step == 1 || this.vertical == true,
            vertical: this.vertical,
        }
    }

    set settings(value) {
        this.toggle_offset(value.offset, false);
        this.toggle_single(value.single, false)
        this.toggle_rtl(value.rtl == 1, false);
        this.toggle_vertical(value.vertical, false);
    }

    get rtl() {
        return -this.ltr;
    }

    get viewnearest() {
        return [...this.viewport.entries()].sort((a, b) => b[1] - a[1])[0]?.shift();
    }

    get viewtop() {
        return [...this.viewport.keys()].sort((a, b) => b - a)[0];
    }

    get URL() {
        return window.URL || window.webkitURL;
    }

    /**
     * Open manga and init.
     * @async
     * @returns If no directory selected.
     */
    async open_manga() {
        const handle = await window.showDirectoryPicker().catch(err => {
            Notifier.info(preset.INFO_CANCELLED);
            return;
        });
        if (handle === undefined) return;
        controller = new Manga(handle);
        await controller.init();
    }

    /**
     * Open episode and init.
     * @async
     * @returns If no directory selected.
     */
    async open_episode() {
        const handle = await window.showDirectoryPicker().catch(err => {
            Notifier.info(preset.INFO_CANCELLED);
            return;
        });
        if (handle === undefined) return;
        controller = new Episode(handle);
        await controller.init();
    }

    /**
     * Open ePub file and init.
     * @async
     * @returns If no ePub file selected.
     */
    async open_epub() {
        const opts = {
            types: [
                {
                    // description: '',
                    accept: {
                        'application/epub+zip': ['.epub']
                    }
                }
            ]
        };
        const [handle] = await window.showOpenFilePicker(opts).catch(err => {
            Notifier.info(preset.INFO_CANCELLED);
            return [undefined];
        });
        if (handle === undefined) return;
        controller = new Epub(handle);
        await controller.init();
    }

    /**
     * Open WebRTC and start manual signaling procedure.
     * @deprecated
     * @async
     */
    //**@deprecated */
    async open_webrtc() {
        // TODO: Working flow should be reconsidered
        if (!this.webrtc.connected) this.toggle_webrtc();
    }

    /**
     * Page up by step.
     */
    page_up() {
        this._page_move(-this.step);
        this._update();
    }

    /**
     * Page down by step.
     */
    page_down() {
        this._page_move(this.step);
        this._update();
    }

    /**
     * Scroll into view of specified page if vertical mode.
     * Update current page if horizontal mode.
     * @param {event} event Progress bar drag event.
     */
    page_drag(event) {
        const index = event.target.value - 1;
        if (this.vertical) {
            document.getElementById('image-list').children[index].scrollIntoView();
            this.viewport.clear();
            this.viewport.set(index, 1);
        } else {
            this.cur = index * this.step;
            this._update();
        }
    }

    /**
     * Proceed to page up or page down by light-to-right or right-to-left order.
     */
    page_arrowleft() {
        this._page_move(-this.ltr * this.step);
        this._update();
    }

    /**
     * Proceed to page up or page down by light-to-right or right-to-left order.
     */
    page_arrowright() {
        this._page_move(this.ltr * this.step);
        this._update();
    }

    /**
     * Scale up by 0.1 ratio.
     * @returns If maximum ratio 2 reached.
     */
    scale_up() {
        if (this._to_fixed(this.ratio, 1) == 2) return;
        this.ratio += 0.1;
        this._scale();
        this._update_scale();
    }

    /**
     * Scale down by 0.1 ratio.
     * @returns If minimal ratio 0.5 reached.
     */
    scale_down() {
        if (this._to_fixed(this.ratio, 1) == 0.5) return;
        this.ratio -= 0.1;
        this._scale();
        this._update_scale();
    }

    /**
     * Scale reset to 1 ratio.
     */
    scale_reset() {
        this.ratio = 1;
        this._scale();
        this._update_scale();
    }

    //* @deprecated
    copy_text(span) {
        let input = span.children[0];
        input.select();
        // Clipboard API requires SECURE context, aka HTTPS connection or localhost
        // Fallback to deprecated method document.execCommand
        if (navigator.clipboard) {
            document.execCommand("copy");
        } else {
            navigator.clipboard?.writeText(input.value);
        }
        if (input.id == 'answer-responsed') this._webrtc_connecting();
    }

    //* @deprecated
    async paste_text(span) {
        let input = span.children[0];
        input.select();
        // Clipboard API requires SECURE context, aka HTTPS connection or localhost
        // There is no way to fallback
        input.value = await navigator.clipboard?.readText();
        if (input.id == 'offer-provided') this.receive_offer();
        if (input.id == 'answer-replied') this.receive_answer();
    }


    /**
     * Toggle contents popup dialog.
     */
    toggle_contents() {
        document.getElementById('manga-contents').classList.toggle('hidden');
    }

    /**
     * Toggle fullscreen mode.
     */
    toggle_fullscreen() {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen();
        } else {
            if (document.exitFullscreen) {
                document.exitFullscreen();
            }
        }
    }

    /**
     * Toggle WebRTC connection dialog.
     */
    toggle_webrtc() {
        let dialog = document.getElementById('dialog-webrtc');
        let elements = Array.from(dialog.getElementsByClassName('hidden')).concat(dialog);
        elements.forEach(element => (element.classList.toggle('hidden')));
        document.getElementById('dialog-close-webrtc').addEventListener('click', event => (
            elements.forEach(element => (element.classList.toggle('hidden')))
        ), { once: true });
    }

    /**
     * Toggle help dialog.
     */
    toggle_help() {
        let dialog = document.getElementById('dialog-help');
        let elements = Array.from(dialog.getElementsByClassName('hidden')).concat(dialog);
        elements.forEach(element => (element.classList.toggle('hidden')));
        document.getElementById('dialog-close-help').addEventListener('click', event => (
            elements.forEach(element => (element.classList.toggle('hidden')))
        ), { once: true });
    }

    /**
     * Toggle navigator buttons disable state.
     *
     * Disable if in {@link Episode} or {@link Epub} mode.
     * Enable if in {@link Manga} mode or remote Manga mode from {@link WebRTCClient}.
     *
     * It will be further set under specified condition in {@link Manga._update_nav}.
     */
    toggle_nav() {
        Array.from(document.querySelectorAll('button[data-navigator].app-button')).forEach(element => (
            element.disabled = this.type != type.manga
        ));
    }

    /**
     * Toggle image rotate state, and modify corresponding button icon and content.
     * @param {event} event Event binded to corresponding button.
     */
    toggle_rotate(event) {
        Notifier.loading();
        this._flush();
        let button = event.target;
        if (button.tagName.toLowerCase() != 'button') button = button.parentNode;
        if (this.rotate == this.rotate_flags.default) {
            button.classList.remove('default');
            button.classList.add('rotate_90_clockwise');
            this.rotate = this.rotate_flags.rotate_90_clockwise;
            this.toggle_single(true, false);
        } else {
            button.classList.remove('rotate_90_clockwise');
            button.classList.add('default');
            this.rotate = this.rotate_flags.default;
            this.toggle_single(false, false);
        }
        this._update_images();
        this._update_progress();
        this._update_hinter();
    }

    /**
     * Toggle reader setting dialog hidden and visible state.
     */
    toggle_settings() {
        document.getElementById('reader-setting').classList.toggle('hidden');
    }

    /**
     * Update step and check edge conditions.
     * @param {number} value Number that specifies the value of step.
     * @param {boolean} [update] Boolean that specifies whether to update or not.
     */
    toggle_step(value, update = true) {
        this.step = value;
        // These two condition check prevent some edge cases, and should run not just when step changes,
        // but each time these values are accessed, since the step is occasionall changed without trigger these functions,
        // and it will conflit with settings saved in indexedDB, causing unintended behavior or dead loop
        // After the values are set, skip update since there is no visual change
        // When step changes from 1 to 2, whatever this.offset is, this.cur should NOT BE odd
        // Or the first page becomes unreachable
        if (this.step == 2 && this.cur % 2) {
            this.cur += -2 * this.offset + 1;
            this.toggle_offset(undefined, false);
        }
        // When step changes from 2 to 1, if this.offset is 1, this.cur should NOT BE 0
        // Or the first page becomes blank
        if (this.step == 1 && this.offset == 1 && this.cur == 0) {
            this.cur = 1;
        }
        if (update) this._write_settings().then(_ => this._update());
    }

    /**
     * Toggle horizonal mode between double-page and single-page.
     * @param {boolean} value Boolean that specifies single page mode.
     * @param {boolean} [update] Boolean that specifies whether to update or not.
     */
    toggle_single(value, update = true) {
        if (this.step == 1 != value) {
            const container = document.getElementById('images-container');
            container.classList.toggle('single-page');
            container.classList.toggle('double-page');
            Array.from(document.querySelectorAll('button[data-setting]'))
                .filter(element => element.dataset.setting >= 2 && element.dataset.setting <= 3)
                .forEach(element => {
                    element.classList.remove('selected');
                    if (element.dataset.setting == (value ? 3 : 2)) element.classList.add('selected');
                });
            const step = value ? 1 : 2;
            this.toggle_step(step, update);
            if (update) this._write_settings().then(_ => this._update());
        }
    }

    /**
     * Toggle reader UI hidden and visible state, and modify corresponding button content.
     */
    toggle_ui(force = false) {
        let ui = document.getElementById('reader-ui');
        let buttons = document.getElementById('floating-buttons');
        if (ui.classList.contains('v-hidden')) {
            ui.classList.remove('v-hidden');
            ui.classList.add('idle');
            buttons.classList.remove('stable');
        } else if (force == false) {
            // Hide reader ui if force param is unspecified
            ui.classList.add('a-fade-out');
            ui.classList.remove('autohide');
        }
    }

    /**
     * Toggle offset.
     * @param {number|undefined} [value] Set offset to value provided, or toggle between 0 or 1 if not.
     * @param {boolean} [update] Boolean that specifies whether to update reader or not.
     */
    toggle_offset(value, update = true) {
        this.offset = typeof value !== 'undefined' ? value : (this.offset + 1) % 2;
        if (update) this._write_settings().then(_ => this._update());
    }

    /**
     * Toggle RTL mode.
     * @param {boolean} value Boolean that specifies the Right-to-Left mode state.
     * @param {boolean} [update] Boolean that specifies whether to update reader or not.
     */
    toggle_rtl(value, update = true) {
        if (this.ltr != (value ? -1 : 1)) {
            document.getElementById('images-container').classList.toggle('use-rtl');
            document.getElementById('current-page').classList.toggle('left-position');
            document.getElementById('current-page').classList.toggle('right-position');
            document.getElementById('next-page').classList.toggle('left-position');
            document.getElementById('next-page').classList.toggle('right-position');
            document.getElementById('message-image-container').classList.toggle('flip');
            Notifier.show_dir();
            this.ltr = value ? -1 : 1;
            this._reset_hinter();
            if (update) this._write_settings().then(_ => this._update());
        }
    }

    /**
     * Toggle vertical mode.
     * @param {boolean} value Boolean that specifies the vertical mode state.
     * @param {boolean} [update] Boolean that specifies whether to update reader or not.
     */
    toggle_vertical(value, update = true) {
        if (this.vertical != value) {
            document.getElementById('reader-body').classList.toggle('horizontal-mode');
            document.getElementById('reader-body').classList.toggle('vertical-mode');
            document.getElementById('offset').disabled = !this.vertical;
            document.getElementById('rotate').disabled = !this.vertical;
            Array.from(document.querySelectorAll('button[data-setting]'))
                .filter(element => element.dataset.setting >= 4)
                .forEach(element => {
                    element.classList.remove('selected');
                    if (element.dataset.setting == (value ? 5 : 4)) element.classList.add('selected');
                });
            let settings = Array.from(document.querySelectorAll('.section[data-setting]'));
            settings.pop();
            settings.forEach(element => element.classList.toggle('hidden'));
            this.vertical = value;
            this._reset_hinter();
            // If vertical mode is enabled, step should be 1
            if (update) this._write_settings();
        }
    }

    /**
     * Toggle theme between light and dark.
     */
    toggle_theme() {
        document.documentElement.classList.toggle('theme-dark');
        document.documentElement.classList.toggle('theme-light');
        this.theme = (this.theme + 1) % 2;
        localStorage.setItem('theme', this.theme);
    }

    // WebRTC Auto Signaling
    //* @deprecated
    _webrtc_signaling_peer_connection_callback(address) {
        // Send SDP to each peer connected with local
        this.signaling.bugout.send(address, this.webrtc.pc.localDescription);
    }

    //* @deprecated
    _webrtc_signaling_peer_message_callback(address, message, packet) {
        const candidates = document.getElementById('webrtc-candidates');
        switch (message.type) {
            case 'offer':
                this.webrtc.pc.addIceCandidate(message);
                let entry = document.createElement('p');
                entry.innerText = address;
                entry.dataset.address = address;
                entry.dataset.sdp = message.sdp;
                entry.onclick = async event => {
                    const remote = event.target;
                    await this.webrtc.pc.setRemoteDescription({ type: "offer", sdp: remote.dataset.sdp });
                    await this.webrtc.pc.setLocalDescription(await this.webrtc.pc.createAnswer());
                    this.signaling.bugout.send(remote.dataset.address, this.webrtc.pc.localDescription);
                }
                candidates.appendChild(entry);
                break;
            case 'answer':
                this.webrtc.pc.setRemoteDescription(message);
                break;
            default:
                console.error(...Badge.args(badges.MangaNative, badges.WebRTC), 'Undefined behavior.');
        }
    }

    //* @deprecated
    _webrtc_signaling_connections_callback(count) {
        console.info(...Badge.args(badges.MangaNative, badges.WebRTC), 'Active connections: ', count);
    }

    async _webrtc_negotiation_needed_callback() {
        const offer = await this.webrtc.pc.createOffer();
        const textarea = document.getElementById('offer-generated');
        this.webrtc.pc.setLocalDescription(offer);
        textarea.value = offer.sdp;
        textarea.select();
    }

    // WebRTC Manual Signaling
    //* @deprecated
    async create_offer() {
        let offer = document.getElementById('offer-generated');
        await this.webrtc.pc.setLocalDescription(await this.webrtc.pc.createOffer());
        this.webrtc.pc.onicecandidate = ({ candidate }) => {
            if (candidate) return;
            offer.value = this.webrtc.pc.localDescription.sdp;
            offer.select();
        };
    }

    //* @deprecated
    async receive_offer() {
        let offer = document.getElementById('offer-provided');
        let answer = document.getElementById('answer-responsed');
        // if (this.webrtc.pc.signalingState != "stable") return;
        if (!offer.value.endsWith('\n')) offer.value += '\n';
        await this.webrtc.pc.setRemoteDescription({ type: "offer", sdp: offer.value });
        await this.webrtc.pc.setLocalDescription(await this.webrtc.pc.createAnswer());
        this.webrtc.pc.onicecandidate = ({ candidate }) => {
            if (candidate) return;
            answer.focus();
            answer.value = this.webrtc.pc.localDescription.sdp;
            answer.select();
        };
        // TODO: Action needed if working redesigned
        this.client = true;
    };

    //* @deprecated
    receive_answer() {
        let answer = document.getElementById('answer-replied');
        if (this.webrtc.pc.signalingState != "have-local-offer") return;
        if (!answer.value.endsWith('\n')) answer.value += '\n';
        this.webrtc.pc.setRemoteDescription({ type: "answer", sdp: answer.value });
        this._webrtc_connecting();
    };

    async _load_files(handle) {
        let files = (await Array.fromAsync(handle.entries(), ([_, entry], index) => entry))
            .filter(entry => entry.kind === 'file')
            .map(entry => {
                entry.scope = this.index;
                entry.format = entry.name.split('.').pop();
                return entry;
            });
        files.sort((a, b) => (a.name.localeCompare(b.name, {}, { numeric: true })));
        return files;
    }

    /**
     * Prefetch specified number of images to cache.
     * @async
     * @param {number} [limit] Override default prefetch limit if provided.
     */
    async _prefetch(limit = this.limit) {
        const length = this.files.length;
        for (let index = 0, cur = this.cur; index < limit && cur < length && length > 0; index++, cur++) {
            // Already cached
            if (this.cache.has(cur)) continue;
            // Fetch and cache
            this._fetch(cur);
        }
    }

    /**
     * Fetch and generate ObjectURL of specified image.
     * @async
     * @param {number} index Number that specifies the index of image to load.
     * @returns {Promise<string>} Object URL which indicates the blob data of the fetched image.
     */
    async _postfetch(index) {
        // If cache missed, fallback to normal fetch
        const blob = await this.cache.get(index) || await this._fetch(index);
        return blob;
    }

    /**
     * Fetch specified image, and then save to cache.
     * @async
     * @param {number} index Number that specifies the index of image to load.
     * @param {Array} [files] Defaults to {@link Base.files}, or provided override value such as {@link WebRTC.files}.
     * @returns {Promise<Blob>} Blob data which indicates the fetched image.
     */
    async _fetch(index, files = this.files) {
        if (files == null) files = this.files;
        const content = await this._file(index, files);
        // Cache if not empty
        if (content.size) this.cache.set(index, content);
        return content;
    }

    /**
     * Fetch specified image.
     * @async
     * @param {number} index Number that specifies the index of image to load.
     * @param {Array} [files] Defaults to {@link Base.files}, or provided override value such as {@link WebRTC.files}.
     * @returns {Promise<Blob>} Blob data which indicates the fetched image.
     */
    async _file(index, files = this.files) {
        if (files == null) files = this.files;
        if (index > files.length) return new Blob();
        let blob = await files[index].getFile().catch(async err => {
            switch (err.name) {
                case "NotAllowedError":
                    Notifier.error(preset.ERR_NOT_ALLOWED);
                    if (await this._verify()) return await files[index].getFile().catch(err => {
                        console.error(...Badge.args(badges.MangaNative), err);
                    });
                    break;
                case "NotFoundError":
                    await this.load(false);
                    return await files[index].getFile().catch(err => {
                        console.error(...Badge.args(badges.MangaNative), err);
                        Notifier.error(preset.ERR_NOT_FOUND);
                    });
                    break;
                default:
                    throw err;
            }
        });
        if (blob === undefined) return new Blob();
        if (blob.type.length === 0) blob = blob.slice(0, blob.size, mime[files[index].format]);
        if (files[index].format !== 'psd') return blob;
        let file = await files[index].getFile();
        let buffer = await file.arrayBuffer();
        let psd = new this.psd(new Uint8Array(buffer));
        psd.parse();
        return await fetch(psd.image.toBase64()).then(res => res.blob());
    }

    /**
     * Init vertical images.
     * @async
     */
    async _init_vertical() {
        let list = document.getElementById('image-list');
        let next = document.getElementById('load-next-btn');
        Array.from(list.children).forEach(element => (
            list.removeChild(element)
        ));
        list.id = "image-list";
        list.classList.add('image-list', 'm-auto', 'over-hidden');
        next.disabled = true;
        for (const [index, handle] of this.files.entries()) {
            let image = document.createElement('img');
            image.dataset.index = index;
            this.observer['image'].observe(image);
            this.observer['progress'].observe(image);
            let container = document.createElement('div');
            container.classList.add('img-container', 'w-100', 'h-100');
            let item = document.createElement('div');
            item.dataset.index = index;
            item.classList.add('image-item', 'p-relative', 'unselectable');
            container.appendChild(image);
            item.appendChild(container);
            // If switch forward and backward instantly, there will be redundant entries
            // However it's far beyond normal user behavior, so won't fix
            if (handle.scope == (this.client ? this.webrtc.scope : this.index)) list.appendChild(item);
        }
    }

    /**
     * Initializes the IndexedDB database for storing reader settings.
     * Creates a database named 'manga-native-database' with a 'settings' object store.
     * @private
     */
    _init_indexeddb() {
        const name = 'manga-native-database';
        const version = 1; // NOT float number
        const request = indexedDB.open(name, version);
        request.onsuccess = event => {
            this.db = event.target.result;
            this.db.onversionchange = _ => {
                this.db.close();
                console.warn(...Badge.args(badges.MangaNative, badges.IndexedDB), 'Reloading...');
                location.reload();
            }
        };
        request.onblocked = event => console.error(...Badge.args(badges.MangaNative, badges.IndexedDB), 'Open failed:', event.target.errorCode);
        request.onerror = event => console.error(...Badge.args(badges.MangaNative, badges.IndexedDB), 'Open failed:', event.target.errorCode);
        request.onupgradeneeded = event => {
            this.db = event.target.result;
            const name = 'settings';
            this.db.createObjectStore(name, { keyPath: 'handle', autoIncrement: false });
            console.info(...Badge.args(badges.MangaNative, badges.IndexedDB), 'Upgrade needed.');
        };
    }

    /**
     * Initializes intersection observers for image loading, page step tracking, and scroll progress.
     * - image: Handles lazy loading of images when they enter viewport
     * - step: Tracks visibility of secondary image for auto single/double page mode
     * - progress: Tracks scroll progress for vertical reading mode
     * @private
     */
    _init_observer() {
        this.observer['image'] = new IntersectionObserver((entries, observer) => (
            entries.forEach(async entry => {
                if (entry.isIntersecting) {
                    const image = entry.target;
                    const index = parseInt(image.dataset.index, 10);
                    const _load = async (image, index) => {
                        // Prevent request amplification, send request for same file once
                        if (image.dataset.requested) return;
                        image.dataset.requested = true;
                        image.src = await this._postfetch(index);
                        image.parentNode.parentNode.classList.add('image-loaded');
                        observer.unobserve(image);
                    }
                    _load(image, index);
                    // If scroll too fast, the previous image is not being loaded sometimes
                    if (index > 0) {
                        const sibling = document.querySelector(`img[data-index="${index - 1}"]`);
                        if (sibling.parentNode.parentNode.classList.contains('image-loaded') === false) {
                            _load(sibling, index - 1);
                        }
                    }
                }
            })
        ));
        this.observer['step'] = new IntersectionObserver((entries, observer) => (
            entries.forEach(entry => {
                // If entry.intersectionRatio == 0, it indicates that the secondary image is hidden
                const step = entry.intersectionRatio == 0 ? 1 : 2;
                // Update step without saving to database
                if (controller.vertical == false && entry.target.classList.contains('hidden') == false) controller.toggle_step(step, false);
                // Do NOT automatically update settings in observer
                // This intersection observer is used to autohide secondary image on devices
                // which is not wide enough to display in double page mode,
                // So save those changes into settings will be meaningless.
                // if (this.type != type.undefined) this._write_settings().then(_ => this._update());
                if (controller.type != type.undefined) controller._update();
                controller._reset_hinter();
            })
        ));
        this.observer['progress'] = new IntersectionObserver((entries, observer) => (
            entries.forEach(entry => {
                const image = entry.target;
                const index = parseInt(image.dataset.index, 10);
                if (entry.intersectionRatio > 0) this.viewport.set(index, entry.intersectionRatio);
                if (entry.intersectionRatio == 0) this.viewport.delete(index);
                controller._update_hinter();
                controller._update_progress();
            })
        ), { threshold: Array.apply(null, { length: 11 }).map((_, index) => index / 10) });
    }

    /**
     * Initializes step observer for secondary image container.
     * The observer tracks visibility of secondary image for auto single/double page mode.
     * The visibility is controlled by CSS media queries or specified manually.
     * @private
     */
    _observe_step() {
        const image = document.getElementById('image-secondary');
        const video = document.getElementById('video-secondary');
        this.observer['step'].observe(image);
        this.observer['step'].observe(video);
    }

    /**
     * Handles image rotation by passing image data through WebAssembly module.
     * @param {Blob} blob - The image blob to rotate
     * @returns {Promise<Blob>} The rotated image blob
     * @private
     * @async
     */
    async _rotate_wrapper(blob) {
        if (this.rotate >= 0) {
            let buffer = await blob.arrayBuffer();
            this.module.FS.writeFile('image', new Uint8Array(buffer));
            blob = new Blob([await this.module.rotate_image('image', this.rotate)], {
                type: blob.type
            });
        }
        return blob;
    }

    //* @deprecated
    async _update_canvas() {
        const id = {
            primary: 'image-primary',
            secondary: 'image-secondary',
        }
        let origin = {
            primary: document.getElementById(id.primary),
            secondary: document.getElementById(id.secondary),
        }
        if (this._validate(this.pos.primary) && this.primary != origin.primary.dataset.index) {
            let primary = await this.cache.get(this.primary);
            primary.id = id.primary;
            console.log(...Badge.args(badges.MangaNative), origin.primary, primary)
            origin.primary.replaceWith(primary);
        }
        if (this._validate(this.pos.secondary) && this.step == 2 && this.secondary != origin.secondary.dataset.index) {
            let secondary = await this.cache.get(this.secondary);
            secondary.id = id.secondary;
            console.log(...Badge.args(badges.MangaNative), origin.secondary, secondary)
            origin.secondary.replaceWith(secondary);
        }
    }

    /**
     * Updates horizontal displayed images based on current state.
     * Sets image sources, triggers prefetch, and notify if file list is empty.
     * @private
     * @async
     */
    async _update_images() {
        document.getElementById('image-primary').src = this._validate(this.pos.primary) ? await this._postfetch(this.primary) : '';
        document.getElementById('image-secondary').src = this._validate(this.pos.secondary) && this.step == 2 ? await this._postfetch(this.secondary) : '';
        this._prefetch();
        if (this.files.length == 0) Notifier.error(preset.ERR_NO_FILES);
    }

    /**
     * Updates horizontal displayed images or videos based on current state.
     * Sets media sources, triggers prefetch, and notify if file list is empty.
     * @private
     * @async
     */
    async _update_media() {
        const _update = async (symbol, index) => {
            const image = document.getElementById(symbol == this.pos.primary ? 'image-primary' : 'image-secondary');
            const video = document.getElementById(symbol == this.pos.primary ? 'video-primary' : 'video-secondary');
            const types = {
                'video': {
                    update: async (blob) => {
                        image.classList.add('hidden');
                        video.classList.remove('hidden');
                        // For videos, directly use blob URL without rotation
                        video.src = this.URL.createObjectURL(blob);
                    }
                },
                'image': {
                    update: async (blob) => {
                        image.classList.remove('hidden');
                        video.classList.add('hidden');
                        const rotated = await this._rotate_wrapper(blob);
                        image.src = this.URL.createObjectURL(rotated);
                    }
                },
                'default': {
                    update: () => {
                        image.classList.remove('hidden');
                        video.classList.add('hidden');
                        image.src = '';
                        video.src = '';
                    }
                }
            }

            let type = 'default';
            let blob = null;
            if (this._validate(symbol)) {
                if (!(symbol == this.pos.secondary && this.step == 1)) {
                    blob = await this._postfetch(index);
                    type = blob.type.split('/')?.at(0);
                }
            }

            await types[type].update(blob);
        };

        await _update(this.pos.primary, this.primary);
        await _update(this.pos.secondary, this.secondary);
        this._prefetch();
        if (this.files.length == 0) Notifier.error(preset.ERR_NO_FILES);
    }

    /**
     * Verifies read permission of File System Access API.
     * If permission denied, request permission again.
     * @returns {Promise<boolean>} True if permissions granted, false otherwise
     * @private
     * @async
     */
    async _verify() {
        const options = { mode: "read" };
        if (this.handle === undefined) {
            return false;
        }
        if ((await this.handle.queryPermission(options)) === 'granted') {
            return true;
        }
        if ((await this.handle.requestPermission(options)) === 'granted') {
            return true;
        }
        return false;
    }

    /**
     * Clears current image sources.
     * @private
     */
    _flush() {
        document.getElementById('image-primary').src = '';
        document.getElementById('video-primary').src = '';
        document.getElementById('image-secondary').src = '';
        document.getElementById('video-secondary').src = '';
    }

    /**
     * Calculates left-to-right position index based on current state.
     * @deprecated It's not used anywhere, and I forgot why I wrote this.
     * @param {Symbol} [pos=this.pos.primary] - Position symbol (primary/secondary)
     * @returns {number} Position index (0 or 1)
     * @private
     */
    //**@deprecated */
    _ltr(pos = this.pos.primary) {
        return (((pos === this.pos.secondary) ? 1 : -1) * this.ltr + 1) / 2;
    }

    /**
     * Validates if page navigation is possible and shows appropriate errors.
     * @param {number} after - Target page index after navigation
     * @returns {boolean} True if navigation is valid
     * @private
     */
    _page_check(after) {
        if (after - this.step % 2 * this.offset < 0) Notifier.error(preset.ERR_ALREADY_FIRST_PAGE)
        else if (after >= this.files.length + this.offset) Notifier.error(preset.ERR_ALREADY_LAST_PAGE);
        return after - this.step % 2 * this.offset >= 0 && after < this.files.length + this.offset;
    }

    /**
     * Moves current page by specified offset if valid.
     * @param {number} offset - Number of pages to move (positive or negative)
     * @private
     */
    _page_move(offset) {
        if (this.vertical) return;
        if (this._page_check(this.cur + offset)) this.cur += offset;
    }

    /**
     * Reads and applies initial settings from UI elements.
     * @private
     */
    _read_setting() {
        Array.from(document.getElementById('reader-setting').querySelectorAll('button.selected')).forEach(element => {
            if (element.dataset.setting > 4) this.vertical = element.dataset.setting == 5;
            if (element.dataset.setting < 2) this.ltr = element.dataset.setting == 1 ? -1 : 1;
        });
    }

    /**
     * Resets reader state by clearing caches and arrays.
     * @param {boolean} [full=false] - If true, also resets current page to 0
     * @private
     */
    _reset(full = false) {
        this.cache = new Map();
        this.files = new Array();
        this.viewport.clear();
        if (full) this.cur = 0;
    }

    /**
     * Resets hinter UI elements based on current view mode.
     * @private
     */
    _reset_hinter() {
        let hinter = document.getElementById('hinter-image');
        hinter.classList.remove('flip', 'rotate');
        hinter.parentNode.classList.remove('double', 'single');
        if (this.ltr == -1) hinter.classList.add('flip');
        if (this.step == 1 || this.vertical) hinter.parentNode.classList.add('single')
        else hinter.parentNode.classList.add('double');
        if (this.vertical) hinter.classList.add('rotate');
    }

    /**
     * Resets content panel to hidden state.
     * @private
     */
    _reset_content() {
        document.getElementById('manga-contents').classList.add('hidden');
    }

    /**
     * Handles image scaling for both horizontal and vertical modes.
     * Updates CSS classes and scroll positions to maintain view.
     * @private
     */
    _scale() {
        let container = document.getElementById('images-container');
        let parent = container.parentNode;
        let list = document.getElementById('image-list');
        let button = document.getElementById('load-next-btn-container');

        // Add scale ratio history
        this.scale.push(this._to_fixed(this.ratio, 1));

        // CSS classes like .w-25 .w-30 .w-35 ... .w-100 .w-110 ... .w-200
        const classes = Array.apply(null, { length: 16 }).map((_, index) => `w-${index * 5 + 25}`).concat(
            Array.apply(null, { length: 10 }).map((_, index) => `w-${index * 10 + 110}`));

        // Horizontal scale
        Array.from(container.querySelectorAll('img')).forEach(element => {
            element.style.marginTop = `${Math.round(Math.max(0, 1 - this.ratio) * 10) * 10}vh`;
            element.style.transform = `scale(${this.ratio})`;
        });
        const origin = {
            ratio: this.scale.shift(),
            scrollTop: parent.scrollTop,
            scrollLeft: parent.scrollLeft,
        };
        if (this.ratio >= 1) {
            container.classList.remove(...classes);
            container.classList.add(`w-${Math.round(this.ratio * 100)}`);
            // origin.scrollTop - base = X - base
            // X = origin.scrollTop - (parent.clientHeight / 2) * (origin.ratio - 1) + (parent.clientHeight / 2) * (this.ratio - 1)
            parent.scrollTo({
                top: origin.scrollTop + (parent.clientHeight / 2) * (this.ratio - origin.ratio),
                left: origin.scrollLeft + (parent.clientWidth / 2) * (this.ratio - origin.ratio),
                behavior: 'instant'
            });
        }

        // Vertical scale
        // If use transform attribute like it is in horizontal mode,
        // the height won't change which will cause several issues,
        // the transform attribute applied on the button is workaround for this.
        // So remove them and change width directly, browser will do the rest.
        // However, setting width directly will cause .image-list width: 100vw overrided on mobile resolution.
        // So add width class to change width
        list.classList.remove(...classes);
        list.classList.add(`w-${Math.round(this.ratio * 50)}`);
        // Scroll to nearest image instead of first image,
        // nor the viewtop image which may vary very often since intersection observer threshold is 0
        // Skip if directory is empty, which leads to undefined child
        list.children[isNaN(this.viewnearest) ? 0 : this.viewnearest]?.scrollIntoView({ behavior: 'instant' });
    }

    /**
     * Sets version number in UI if available in localStorage.
     * Creates version element if it doesn't exist.
     * @private
     */
    _set_version() {
        const value = localStorage.getItem('version');
        if (value == null) return;
        // Create version tag if not exists
        let version = document.getElementById('version');
        if (version) {
            version.textContent = value;
        } else {
            version = document.createElement('span');
            version.id = 'version';
            version.classList.add(...['version', 'dp-flex', 'v-middle']);
            version.textContent = value;
            document.getElementById('title').parentNode.appendChild(version);
        }
    }

    /**
     * Checks if an element is visible in vertical scroll mode.
     * @deprecated
     * @param {HTMLElement} element - Element to check visibility
     * @returns {boolean} True if element is visible
     * @private
     */
    //**@deprecated */
    _scroll_vertical_visibile(element) {
        let bounding = element.getBoundingClientRect();
        return (
            bounding.top <= (window.innerHeight || document.documentElement.clientHeight) &&
            bounding.bottom >= 0 &&
            this.vertical
        )
    };

    /**
     * Rounds a number to specified decimal places.
     * @param {number} value - Number to round
     * @param {number} float - Number of decimal places (must be positive integer)
     * @returns {number} Rounded number
     * @throws {Object} Error if float parameter is invalid
     * @private
     */
    _to_fixed(value, float) {
        if (float <= 0 || Math.round(float) != float) throw { msg: 'Value must be an interger which is greater than 0.', value: float };
        return (Math.round(parseFloat(value) * 10 * float) / (10 * float));
    }

    /**
     * Validates if image position is within bounds of current files.
     * @param {Symbol} [pos=this.pos.primary] - Position to validate
     * @returns {boolean} True if position is valid
     * @private
     */
    _validate(pos = this.pos.primary) {
        return ((pos === this.pos.primary && this.primary >= 0 && this.primary < this.files.length) ||
            (pos === this.pos.secondary && this.secondary >= 0 && this.secondary < this.files.length)) && this.files.length > 0;
    }

    /**
     * Updates all UI elements to reflect current state.
     * @private
     */
    _update() {
        if (this.type == type.undefined) return;
        this._update_media();
        this._update_info();
        this._update_progress();
        this._update_hinter();
        this._update_scale();
    }

    /**
     * Updates page number indicators.
     * @private
     */
    _update_hinter() {
        let current_page = document.getElementById('current-page');
        let next_page = document.getElementById('next-page');
        current_page.innerHTML = !this._validate(this.pos.primary) ? '' : this.primary + 1;
        next_page.innerHTML = !this._validate(this.pos.secondary) ? '' : this.secondary + 1;
        if (this.vertical) current_page.innerHTML = isNaN(this.viewtop) ? '' : this.viewtop + 1;
    }

    /**
     * Updates manga and episode title and info displays.
     * @private
     */
    _update_info() {
        let manga = document.getElementById('manga-title');
        manga.innerHTML = this.title['manga'];
        manga.title = this.title['manga'];
        let episode = document.getElementById('episode-title');
        episode.innerHTML = this.title['episode'];
        episode.title = this.title['episode'];
        document.getElementById('page-count').innerHTML = this.files.length || '';
        // TODO: Change to logged location [Low priority]
    }

    /**
     * Updates progress bar indicators.
     * @private
     */
    _update_progress() {
        let value = this.vertical ? (isNaN(this.viewtop) ? 1 : this.viewtop + 1) : (Math.floor((this.cur + this.offset) / this.step) + 1);
        let max = Math.round((this.files.length + this.offset) / this.step);
        document.getElementsByClassName('progress-indicator')[0].innerHTML = `${value} / ${max}`;
        let progress = document.getElementById('progress-indicator');
        progress.value = value;
        progress.max = max;
    }

    /**
     * Updates scale percentage display.
     * @private
     */
    _update_scale() {
        document.getElementById('scale-percentage').innerHTML = `${Math.round(this.ratio * 100)}%`;
    }

    /**
     * Read current handle settings and update it if needed.
     * @async
     */
    async _update_settings() {
        const handle = await this.handle.getUniqueId()
        let payload = this.settings;
        payload.name = this.handle.name;
        payload.handle = handle;

        // If rotate wrapper is activated, pause all load and save actions.
        // TODO: Open or switch episode while rotate wrapper is on.
        if (this.rotate != this.rotate_flags.default) return;

        // Load settings from IndexedDB
        this.db.transaction('settings').objectStore('settings')
            .get(handle).onsuccess = event => {
                const result = event.target.result;
                if (typeof result === 'undefined') {
                    // If current handle is not in database, save its settings.
                    this._write_settings();
                } else {
                    // If current handle found in database, load its settings.
                    this.settings = result;
                    // If settings from database differs from current setting
                    const _equal = (a, b) => {
                        const keys = Object.keys(b).sort();
                        return Object.keys(a).sort().every((key, index) => a[key] === b[keys[index]]);
                    }
                    if (_equal(payload, result) == false) {
                        this._update();
                    }
                    console.info(...Badge.args(badges.MangaNative, badges.IndexedDB), 'Settings loaded.', payload);
                }
            }
    }

    /**
     * Update current handle settings.
     * @async
     */
    async _write_settings() {
        const handle = await this.handle.getUniqueId()
        let payload = this.settings;
        payload.name = this.handle.name;
        payload.handle = handle;

        return new Promise((resolve, reject) => {
            // Write settings to IndexedDB
            const transaction = this.db.transaction(['settings'], 'readwrite')
            const store = transaction.objectStore('settings');
            const request = store.put(payload);
            request.onsuccess = _ => {
                console.info(...Badge.args(badges.MangaNative, badges.IndexedDB), 'Settings updated.', payload);
                resolve();
            }
            request.onerror = error => {
                console.error(...Badge.args(badges.MangaNative, badges.IndexedDB), 'Settings update failed:', error);
                reject(error);
            }
        });

    }

    //* @deprecated
    _webrtc_connecting() {
        document.querySelectorAll('[id^="answer"]').forEach(element => (
            element.parentNode.classList.add('loading')
        ));
    }

    //* @deprecated
    _webrtc_connected() {
        document.querySelectorAll('[id^="answer"]').forEach(element => {
            element.parentNode.classList.remove('loading');
            element.parentNode.classList.add('accomplished');
        });
        setTimeout(() => (document.getElementById('dialog-webrtc').classList.add('hidden')), 3000);
    }

    _webrtc_connect_callback(event) {
        switch (event.target.connectionState) {
            case "connected":
                // The connection has become fully connected
                this._webrtc_connected();
                if (!this.client) this._webrtc_transmit_meta();
                if (this.client) controller = new WebRTCClient();
                Notifier.info(preset.INFO_WEBRTC_CONNECTED);
                console.info(...Badge.args(badges.MangaNative, badges.WebRTC), 'Connection established.');
                break;
            case "disconnected":
            case "failed":
                // One or more transports has terminated unexpectedly or in an error
                break;
            case "closed":
                // The connection has been closed
                break;
        }
    }

    _webrtc_dc_callback(event) {
        const channel = event.channel;
        if (['file'].includes(channel.label)) this.webrtc.channels.set(channel.id, channel);
    }

    async _webrtc_control_callback(event) {
        let msg = JSON.parse(event.data);
        if (msg.target == this.webrtc.target.client) return;
        switch (msg.cmd) {
            case 'episode':
                this._webrtc_reply_episode(msg.args);
                break;
            case 'fetch':
                await this._webrtc_reply_file(msg.args);
                break;
            default:
                console.error(...Badge.args(badges.MangaNative, badges.WebRTC), 'Unexpected command.')
        }
    }

    async _webrtc_store_meta(rx) {
        return new Promise((resolve) => (
            rx.onmessage = (event) => {
                const payload = JSON.parse(event.data);
                this.meta = payload;
                resolve();
            }
        ))
    }

    async _webrtc_reply_episode(args) {
        let episode = {
            name: '',
            length: 0,
            scope: args.scope,
        };
        // Clear host-side cached webrtc file list
        this.webrtc.files = null;
        switch (this.type) {
            case type.manga:
                // Save file list for future use
                this.webrtc.files = await this._load_files(this.episodes[args.scope]);
                episode.name = this.episodes[args.scope].name;
                episode.length = this.webrtc.files.length;
                break;
            case type.episode:
            case type.epub:
                episode.name = this.title['episode'];
                episode.length = this.files.length;
                break;
        }
        this.webrtc.scope = args.scope;
        this.webrtc.cmd('episode', this.webrtc.target.client, episode);
    }

    async _webrtc_reply_file(args) {
        let file = null;
        let data = null;
        switch (this.type) {
            case type.manga:
                // Bypass cache to avoid affecting host-side display
                file = await this._file(args.index, this.webrtc.files);
                break;
            case type.episode:
            case type.epub:
                file = await this.cache.get(args.index) || await this._fetch(args.index);
                break;
        }
        data = await file.arrayBuffer();
        this.webrtc._transmit_data(data, args.channel);
    }

    _webrtc_transmit_meta() {
        if (this.webrtc.pc.connectionState != 'connected') return;
        let meta = {
            manga: this.title.manga,
            episode: this.title.episode,
            type: this.type,
            episodes: this.episodes ? this.episodes.map(episode => ({ name: episode.name })) : null,
        };
        if (!this.client) {
            this.webrtc._transmit_meta(meta);
            console.info(...Badge.args(badges.MangaNative, badges.WebRTC), 'Meta data transmited:', meta);
        }
    }
}

class Episode extends Base {
    constructor(handle) {
        super();
        // File handle
        this.handle = handle;
        // Type definition
        this.type = type.episode;
    }

    async init() {
        await this.load();
        Notifier.info(preset.INFO_EPISODE_LOADED);
        if (this.files.length == 0) Notifier.error(preset.ERR_NO_FILES);
    }

    async sync() {
        await this.load();
        Notifier.info(preset.INFO_SYNCD);
        if (this.files.length == 0) Notifier.error(preset.ERR_NO_FILES);
    }

    async load(update = true) {
        this._reset();
        this.title['episode'] = this.handle.name;
        this.files = await this._load_files(this.handle);
        this._prefetch();
        this.toggle_nav();
        this._update_settings();
        if (update) this._update();
        this._reset_content();
        this._init_vertical();
        this._webrtc_transmit_meta();
    }
}

class Manga extends Base {
    constructor(handle) {
        super();
        // Episode list
        this.episodes = new Array();
        // Episode index
        this.index = 0;
        // Root directory file handle
        this.root = handle;
        this.handle = handle;
        // Type definition
        this.type = type.manga;
    }

    async init() {
        await this.load();
        Notifier.info(preset.INFO_MANGA_LOADED);
        if (this.episodes.length == 0) Notifier.error(preset.ERR_NO_EPISODES);
    }

    async sync() {
        await this.load();
        Notifier.info(preset.INFO_SYNCD);
        if (this.episodes.length == 0) Notifier.error(preset.ERR_NO_EPISODES);
    }

    async load(update = true) {
        this.episodes = (await Array.fromAsync(this.root.entries(), ([_, entry], index) => entry))
            .filter(entry => entry.kind === 'directory');
        this.episodes.sort((a, b) => (a.name.localeCompare(b.name, {}, { numeric: true })));
        await this._episode_move(0);
        this.toggle_nav();
        this._init_contents();
        this._update_settings();
        if (update) this._update();
        this._webrtc_transmit_meta();
    }

    async episode_up() {
        await this._episode_move(-1);
        this._update();
    }

    async episode_down() {
        await this._episode_move(1);
        this._update();
    }

    async episode_switch(event) {
        await this._episode_move(parseInt(event.target.dataset.index, 10) - this.index);
        this._update();
    }

    async episode_scrolldown() {
        await this._episode_move(1);
        this._update();
    }

    async page_up() {
        await this._page_move(-1);
        this._update();
    }

    async page_down() {
        await this._page_move(1);
        this._update();
    }

    async page_arrowleft() {
        await this._page_move(-this.ltr);
        this._update();
    }

    async page_arrowright() {
        await this._page_move(this.ltr);
        this._update();
    }

    async _episode_move(offset) {
        if (offset == -1) Notifier.info(preset.INFO_PREVIOUS_EPISODE);
        if (offset == 1) Notifier.info(preset.INFO_NEXT_EPISODE);
        if (this._episode_check(this.index + offset)) {
            this.index += offset;
            this._reset(offset);
            this.files = await this._load_files(this.episodes[this.index]).catch(_ => this.load());
            this._prefetch();
            this._init_vertical();
            if (this.vertical) this._scale();
            this.toggle_ui(true);
        } else if (this.index + offset < 0) {
            Notifier.error(preset.ERR_ALREADY_FIRST_EPISODE);
        } else if (this.index + offset >= this.episodes.length) {
            Notifier.error(preset.ERR_ALREADY_LAST_EPISODE);
        }
    }

    async _init_vertical() {
        super._init_vertical();
        let next = document.getElementById('load-next-btn');
        next.disabled = this.index >= this.episodes.length - 1;
    }

    async _page_move(offset) {
        if (this.vertical) return;
        if (this._page_check(this.cur + offset * this.step)) {
            this.cur += offset * this.step;
        } else {
            await this._episode_move(offset);
        }
    }

    _content(title, index) {
        let label = document.createElement('div');
        label.classList.add('label');
        label.dataset.contents = null;
        label.dataset.index = index;
        label.innerHTML = title;
        let button = document.createElement('button');
        button.classList.add('list-item', 'app-button');
        button.dataset.contents = null;
        button.dataset.index = index;
        button.title = title;
        button.appendChild(label);
        return button;
    }

    _episode_check(after) {
        return after >= 0 && after < this.episodes.length;
    }

    _init_contents() {
        document.getElementById('episode-count').innerHTML = this.episodes.length;
        let old = document.getElementById('data-contents');
        let contents = document.createElement('div');
        contents.classList.add('data-list'/*, 'p-relative', 'ps' , 'ps--active-y', 'ps--scrolling-y' */);
        contents.dataset.contents = null;
        contents.id = 'data-contents';
        for (const [index, episode] of this.episodes.entries()) {
            contents.appendChild(this._content(episode.name, index));
        }
        old.parentNode.replaceChild(contents, old);
    }

    _update() {
        super._update();
        this._update_contents();
        this._update_nav();
    }

    _update_info() {
        this.title['manga'] = this.root?.name || '';
        this.title['episode'] = this.episodes[this.index]?.name || '';
        super._update_info();
    }

    _update_contents() {
        Array.from(document.getElementById('data-contents').getElementsByClassName('list-item')).forEach(element => (
            element.classList.remove('selected')
        ));
        document.querySelector(`button[data-index="${this.index}"]`)?.classList?.add('selected', 'read');
    }

    _update_nav() {
        document.getElementById('previous-episode').disabled = this.index - 1 < 0;
        document.getElementById('next-episode').disabled = this.index + 1 >= this.episodes.length;
        document.getElementById('alt-previous-episode').disabled = this.index - 1 < 0;
        document.getElementById('alt-next-episode').disabled = this.index + 1 >= this.episodes.length;
    }
}

class Epub extends Base {
    constructor(handle) {
        super();
        // File handle
        this.handle = handle;
        // Type definition
        this.type = type.epub;
    }

    async init() {
        await this.load();
        Notifier.info(preset.INFO_EPUB_LOADED);
        if (this.files.length == 0) Notifier.error(preset.ERR_NO_FILES);
    }

    async sync() {
        await this.load();
        Notifier.info(preset.INFO_SYNCD);
        if (this.files.length == 0) Notifier.error(preset.ERR_NO_FILES);
    }

    async load(update = true) {
        Notifier.loading();
        this._flush();
        const path = 'tmp.epub';
        const file = await this.handle.getFile();
        let buffer = await file.arrayBuffer();
        this.module.FS.writeFile(path, new Uint8Array(buffer)); // Unicode filename not supported
        this.api.epub_open(path);
        this.title['episode'] = this.handle.name;
        this.files = this._load_files();
        this._prefetch();
        this.toggle_nav();
        this._update_settings();
        if (update) this._update();
        this._reset_content();
        this._init_vertical();
        this._webrtc_transmit_meta();
    }

    _load_files() {
        return Array(this.api.epub_count()).fill().map((_, i) => ({
            scope: this.index,
            format: this.api.epub_format(i),
            getFile: async _ => (new Blob([await this.module.epub_image(i)]))
        }));
    }
}

class WebRTC {
    constructor() {
        const config = { iceServers: [{ url: 'stun:stun.l.google.com' }] };
        this.pc = new RTCPeerConnection(config);
        this.ctrl = this.pc.createDataChannel("ctrl", { negotiated: true, id: 0 });
        this.ctrl.onclose = _ => {
            this.ctrl.close();
            this.ctrl = this.pc.createDataChannel('ctrl', { negotiated: true, id: 0 });
        }
        this.channels = new Map();
        this.scope = 0;
        this.target = Object.freeze({
            host: 0,
            client: 1,
            unspecified: 2,
        })
    }

    get connected() {
        return this.pc.connectionState == 'connected' && this.ctrl.readyState == 'open';
    }

    cmd(cmd, target, args = null) {
        if (this.ctrl.readyState != 'open') {
            console.error(...Badge.args(badges.MangaNative, badges.WebRTC), 'Ctrl channel has been closed.');
            return;
        }
        this.ctrl.send(JSON.stringify({ cmd: cmd, target: target, args: args }));
    }

    async file(index) {
        let args = {
            scope: this.scope,
            index: index,
        };
        return await this._request_data('file', 'fetch', args);
    }

    async _request_data(channel, cmd, args) {
        let rx = this.pc.createDataChannel(channel);
        let buffer = new Array();
        let meta = null;
        let size = 0;
        args['channel'] = rx.id;
        rx.onopen = event => {
            this.channels.set(rx.id, rx);
            rx.binaryType = 'arraybuffer';
            this.cmd(cmd, this.target.host, args);
        };
        rx.onmessage = (event) => {
            const data = event.data;
            if (data instanceof ArrayBuffer) {
                buffer.push(event.data);
                size += event.data.byteLength;
                if (size == meta.size) rx.close();
                return;
            }
            const payload = JSON.parse(data);
            if (payload.type === 'meta') meta = { size: payload.size };
        };
        rx.onerror = (event) => (console.error(...Badge.args(badges.MangaNative, badges.WebRTC), 'Data receive failed.'));
        return new Promise((resolve) => (
            rx.onclose = (event) => {
                this.channels.delete(rx.id);
                resolve(buffer);
            }
        ));
    }

    _transmit_data(data, channel) {
        let offset = 0;
        let tx = this.channels.get(channel);
        if (typeof tx === 'undefined' || tx.readyState != 'open') console.error(...Badge.args(badges.MangaNative, badges.WebRTC), 'Datachannel not ready.');
        tx.send(JSON.stringify({ type: 'meta', size: data.byteLength }))

        let chunk_size = this.pc.sctp.maxMessageSize;
        let low_watermark = chunk_size; // A single chunk
        let high_watermark = Math.max(chunk_size * 8, 1048576); // 8 chunks or at least 1 MiB
        tx.binaryType = 'arraybuffer';
        tx.bufferedAmountLowThreshold = low_watermark;
        tx.onbufferedamountlow = (event) => {
            // this._transmit();
        };
        while (offset < data.byteLength) {
            let buffered_amount = tx.bufferedAmount;
            tx.send(data.slice(offset, offset + chunk_size));
            offset += chunk_size;
            if (buffered_amount >= high_watermark) {
                // Nevermind
            }
        }
        // tx.close();
        tx.onclose = (event) => {
            this.channels.delete(tx.id);
        }
    }

    _transmit_meta(meta) {
        let tx = this.pc.createDataChannel('meta');
        tx.onopen = (event) => {
            tx.send(JSON.stringify(meta));
        }
        // tx.onopen = (event) => (tx.send(JSON.stringify(meta)));
    }
}

class Signaling {
    constructor() {
        const identifier = 'manga_native';
        const opts = {
            torrentOpts: {
                announce: [
                    "wss://hub.bugout.link",
                    "wss://tracker.openwebtorrent.com",
                    "wss://tracker.btorrent.xyz",
                    "wss://tracker.novage.com.ua",
                    "wss://tracker.magnetoo.io",
                    "wss://tracker.sloppyta.co",
                    "wss://video.blender.org:443/tracker/socket",
                    "wss://peertube.cpy.re:443/tracker/socket",
                    "wss://tube.privacytools.io:443/tracker/socket"
                ]
            }
        }
        this.bugout = new Bugout(identifier, opts);
    }
}

class WebRTCClient extends Base {
    constructor() {
        super();
        // WebRTC Client
        this.client = true;
        // Episode list
        this.episodes = new Array();
        // Episode index
        this.index = 0;
        // Episode promise resolve
        this.resolve;
    }

    get episode_up() {
        return Manga.prototype.episode_up;
    }

    get episode_down() {
        return Manga.prototype.episode_down;
    }

    get episode_switch() {
        return Manga.prototype.episode_switch;
    }

    get episode_scrolldown() {
        return Manga.prototype.episode_scrolldown;
    }

    get page_up() {
        return this.type == type.manga ? Manga.prototype.page_up : super.page_up;
    }

    get page_down() {
        return this.type == type.manga ? Manga.prototype.page_down : super.page_down;
    }

    get page_arrowleft() {
        return this.type == type.manga ? Manga.prototype.page_arrowleft : super.page_arrowleft;
    }

    get page_arrowright() {
        return this.type == type.manga ? Manga.prototype.page_arrowright : super.page_arrowright;
    }

    get _page_move() {
        return this.type == type.manga ? Manga.prototype._page_move : super._page_move;
    }

    get _content() {
        return Manga.prototype._content;
    }

    get _episode_check() {
        return Manga.prototype._episode_check;
    }

    get _init_contents() {
        return Manga.prototype._init_contents;
    }

    get _init_vertical() {
        return this.type == type.manga ? Manga.prototype._init_vertical : super._init_vertical;
    }

    get _update() {
        return this.type == type.manga ? Manga.prototype._update : super._update;
    }

    get _update_contents() {
        return Manga.prototype._update_contents;
    }

    get _update_nav() {
        return Manga.prototype._update_nav;
    }

    async load() {
        this._webrtc_parse_meta();
        this.toggle_nav();
        this._reset(true);
        switch (this.type) {
            case type.manga:
                await this._episode_move(0);
                this._init_contents();
                this._update_settings();
                this._update();
                break;
            case type.episode:
            case type.epub:
                this.files = await this._load_files(this.index);
                this.title['episode'] = this.meta.episode;
                this._prefetch();
                this._update_settings();
                this._update();
                this._reset_content();
                break;
        }
    }

    async _episode_move(offset) {
        if (offset == -1) Notifier.info(preset.INFO_PREVIOUS_EPISODE);
        if (offset == 1) Notifier.info(preset.INFO_NEXT_EPISODE);
        if (this._episode_check(this.index + offset)) {
            this.index += offset;
            this._reset(offset);
            this.files = await this._load_files(this.index);
            this._prefetch();
            this._init_vertical();
            if (this.vertical) this._scale();
        } else if (this.index + offset < 0) {
            Notifier.error(preset.ERR_ALREADY_FIRST_EPISODE);
        } else if (this.index + offset >= this.episodes.length) {
            Notifier.error(preset.ERR_ALREADY_LAST_EPISODE);
        }
    }

    async _webrtc_dc_callback(event) {
        const channel = event.channel;
        switch (channel.label) {
            case 'file':
                this.webrtc.channels.set(channel.id, channel);
                break;
            case 'meta':
                await this._webrtc_store_meta(channel);
                this.load();
                break;
        }
    }

    async _webrtc_control_callback(event) {
        let msg = JSON.parse(event.data);
        if (msg.target == this.webrtc.target.host) return;
        switch (msg.cmd) {
            case 'episode':
                this._webrtc_load_files(msg.args);
                break;
            default:
                console.error(...Badge.args(badges.MangaNative, badges.WebRTC), 'Unexpected command.')
        }
    }

    async _webrtc_request_episode(index) {
        let args = {
            scope: index,
        };
        this.webrtc.scope = index;
        this.webrtc.cmd('episode', this.webrtc.target.host, args);
        return new Promise((resolve) => this.resolve = resolve);
    }

    _webrtc_request_meta() {
        this.webrtc.cmd('meta', this.webrtc.target.host);
    }

    _webrtc_parse_meta() {
        if (this.meta == null) return;
        this.type = this.meta.type;
        this.episodes = this.meta.episodes;
        this.index = 0;
    }

    _webrtc_load_files(args) {
        let files = Array(args.length).fill().map((_, i) => ({
            index: i,
            scope: this.webrtc.scope,
            getFile: async _ => (new Blob(await this.cache.get(i) || await this.webrtc.file(i))),
        }));
        this.resolve(files);
    }

    async _load_files(index) {
        return await this._webrtc_request_episode(index);
    }

    _update_info() {
        if (this.meta == null) return;
        switch (this.type) {
            case type.manga:
                this.title['manga'] = this.meta.manga || '';
                this.title['episode'] = this.episodes[this.index]?.name || '';
                break;
            case type.episode:
            case type.epub:
                this.title['manga'] = this.meta.manga || '';
                this.title['episode'] = this.meta.episode || '';
                break;
        }
        super._update_info();
    }
}

class Notifier {
    constructor() {
    }

    static debug(debug, alt) {
        this._toast(debug || alt);
    }

    static info(info, alt) {
        this._toast(info || alt);
    }

    static error(error, alt) {
        this._toast(error || alt);
    }

    static show_dir() {
        this._dir();
    }

    static loaded(trigger) {
        document.getElementById('loading-hinter').classList.add('hidden');
    }

    static loading() {
        document.getElementById('loading-hinter').classList.remove('hidden');
    }

    static _toast(msg) {
        this._clear(this.toast, 'episode-toast');
        document.getElementById('toast-content').innerHTML = msg;
        document.getElementById('episode-toast').classList.remove('hidden');
        this.toast = setTimeout(() => (document.getElementById('episode-toast').classList.add('hidden')), 3000);
    }

    static _dir() {
        this._clear(this.dir, 'message-box');
        document.getElementById('message-box').classList.add('hidden');
        document.getElementById('message-box').classList.remove('hidden');
        this.dir = setTimeout(() => (document.getElementById('message-box').classList.add('hidden')), 3000);
    }

    static _clear(timer, id) {
        window.clearTimeout(timer);
        document.getElementById(id).classList.add('hidden');
    }
}

const preset = Object.freeze({
    INFO_CANCELLED: '已取消选择',
    INFO_EPUB_LOADED: '加载文件成功',
    INFO_EPISODE_LOADED: '加载章节成功',
    INFO_MANGA_LOADED: '加载漫画成功',
    INFO_PREVIOUS_EPISODE: '已切换到上一话',
    INFO_NEXT_EPISODE: '已切换至下一话',
    INFO_SYNCD: '已同步文件内容',
    INFO_WEBRTC_CONNECTED: '已建立连接',
    INFO_BEFORE_UNLOAD: '再次点击以退出',
    INFO_NOT_INITIALIZED: '尚未初始化',

    ERR_ALREADY_FIRST_PAGE: '已经是第一页了',
    ERR_ALREADY_LAST_PAGE: '已经是最后一页了',
    ERR_ALREADY_FIRST_EPISODE: '没有上一话了',
    ERR_ALREADY_LAST_EPISODE: '没有下一话了',
    ERR_NO_FILES: '没有可显示的图片',
    ERR_NO_EPISODES: '没有可显示的章节',
    ERR_NOT_ALLOWED: '没有访问权限',
    ERR_NOT_FOUND: '没有找到文件',

    CUSTOM: null
});

const type = Object.freeze({
    undefined: 0,
    epub: 1,
    episode: 1,
    manga: 2
});

window.addEventListener('DOMContentLoaded', () => init());

// Prevent accidentally exit in PWA
window.addEventListener('load', function () {
    window.history.pushState({}, '')
});

window.addEventListener('popstate', () => {
    // Confirm exiting in 2000ms grace
    const grace = 2000;
    // Show a "Press back again to exit" tooltip
    Notifier.info(preset.INFO_BEFORE_UNLOAD);
    setTimeout(() => {
        window.history.pushState({}, '');
    }, grace);
});

// Register Service Worker
if ('serviceWorker' in navigator) {
    // Register Service Worker
    navigator.serviceWorker.register('/sw.js').then(_ => {
        console.log(...Badge.args(badges.MangaNative, badges.ServiceWorker), 'Service Worker registered.');
    });
    // Listen to the message back
    navigator.serviceWorker.addEventListener('message', event => {
        switch (event.data.command) {
            case 'version':
                console.log(...Badge.args(badges.MangaNative, badges.ServiceWorker), 'Service Worker version:', event.data.version);
                localStorage.setItem('version', event.data.version);
                break;
            case 'reload':
                console.log(...Badge.args(badges.MangaNative, badges.ServiceWorker), 'Reloading...');
                location.reload();
                break;
        }
    });
    // Manually trigger Service Worker update
    navigator.serviceWorker.ready.then((registration) => {
        registration.update();
    });
}

let init = () => {
    let ui = document.getElementById('reader-ui');
    let body = document.getElementById('reader-body');
    let buttons = document.getElementById('floating-buttons');
    let container = document.getElementById('ps-container');
    const theme = localStorage.getItem('theme') | (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.classList.add(theme ? 'theme-light' : 'theme-dark');
    ui.addEventListener('animationend', event => {
        switch (event.animationName) {
            case 'fade-out':
                event.target.classList.add('v-hidden');
                event.target.classList.remove('a-fade-out');
                break;
            case 'move-in-top', 'move-in-bottom':
                event.target.parentNode.classList.remove('idle');
                event.target.parentNode.classList.add('autohide');
                break;
            case 'delayed-move-out-top', 'delayed-move-out-bottom':
                event.target.parentNode.classList.add('v-hidden');
                event.target.parentNode.classList.remove('autohide');
                break;
        }
    });
    ui.addEventListener('mouseleave', event => (
        event.target.classList.add('autohide')
    ));
    buttons.addEventListener('mouseover', event => {

    });
    buttons.addEventListener('animationend', event => {
        if (event.animationName == 'delayed-float-down') {
            event.target.classList.add('stable');
        }
    });
    document.addEventListener('mousemove', event => {
        if (event.pageX < (window.innerWidth / 2)) {
            body.classList.add('arrow-left');
            body.classList.remove('arrow-right');
        } else {
            body.classList.remove('arrow-left');
            body.classList.add('arrow-right');
        }
    }, false);
    Array.from(document.querySelectorAll('button[data-setting]')).forEach(element => (
        element.addEventListener('click', event => {
            let callbacks = {
                '0': () => (controller.toggle_rtl(false)),
                '1': () => (controller.toggle_rtl(true)),
                '2': () => (controller.toggle_single(false)),
                '3': () => (controller.toggle_single(true)),
                '4': () => (controller.toggle_vertical(false, event)),
                '5': () => (controller.toggle_vertical(true, event)),
            }
            callbacks[event.target.dataset.setting]();
            if (!(event.target.disabled || event.target.classList.contains('selected'))) {
                Array.from(event.target.parentNode.children).forEach(element => {
                    element.classList.toggle('selected');
                });
            }
        })
    ));
    Array.from(document.querySelectorAll('[data-bind]')).forEach(element => {
        const name = element.dataset.bind;
        const warning = _ => {
            Notifier.info(preset.INFO_NOT_INITIALIZED);
            console.warn(...Badge.args(badges.MangaNative), 'Not initialized yet.');
        };
        const listener = event => typeof controller === 'undefined' ? warning() : controller[name](event);
        switch (name) {
            case 'image_loaded':
                element.addEventListener('load', _ => Notifier.loaded());
                break;
            case 'page_drag':
                element.addEventListener('input', listener);
                break;
            default:
                element.addEventListener('click', listener);
                break;
        }
    });
    container.addEventListener('mouseup', event => {
        if (event.button != 0) return;
        if (controller.vertical) return;
        if (window.innerWidth < window.innerHeight) return;
        if ((event.pageX < (window.innerWidth / 2)) == (controller.rtl == 1)) {
            controller.page_down();
        } else {
            controller.page_up();
        }
    });
    container.addEventListener('click', event => {
        document.elementsFromPoint(event.clientX, event.clientY).forEach(element => {
            if (element.classList.contains('touch-button')) element.click();
        });
    })
    document.querySelectorAll("button").forEach(button => (
        button.addEventListener('keydown', event => (event.preventDefault()))
    ));
    document.body.onkeyup = event => {
        let ops = {
            "ArrowUp": () => (controller.page_up()),
            "ArrowDown": () => (controller.page_down()),
            "ArrowLeft": () => { if (!controller.vertical) controller.page_arrowleft() },
            "ArrowRight": () => { if (!controller.vertical) controller.page_arrowright() },
            "KeyC": () => (controller.toggle_offset()),
            "PageUp": () => (controller.page_up()),
            "PageDown": () => (controller.page_down()),
            "Backspace": () => (controller.page_up()),
            "Space": () => (controller.page_down()),
            "Enter": () => (controller.toggle_ui())
        };
        (ops[event.code] || (() => void 0))();
    };
    const override = {
        print: Badge.wrap(console.log.bind(console), [badges.MangaNative, badges.WebAssembly]),
        printErr: Badge.wrap(console.error.bind(console), [badges.MangaNative, badges.WebAssembly]),
        locateFile: (path) => ('wasm/' + path),
    }
    Promise.all([Module(override), User.init()]).then(ret => {
        [module, user] = ret;
        webrtc = new WebRTC();
        signaling = new Signaling();
        controller = new Base();
        Notifier.show_dir();
    });
};
