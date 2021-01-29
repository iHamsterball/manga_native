class Base {
    constructor(module, webrtc) {
        // Wasm api
        this.api = {
            // Image processing Section
            analyse: module.cwrap('analyse', 'number', ['string']),
            rotate: module.cwrap('rotate', 'number', ['array', 'number']),
            version: module.cwrap('version', '', []),

            // ePub processing Section
            epub_open: module.cwrap('epub_open', 'number', ['string']),
            epub_count: module.cwrap('epub_count', '', []),
            // epub_bundle: module.cwrap('epub_bundle', '', []),
            // epub_image: module.cwrap('epub_image', 'number', ['number'])
        };
        // WebRTC Host
        this.client = false;
        // Current page & offset
        this.cur = this._offset = 0;
        // File list
        this.files = new Array();
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
        // Page step
        this.step = 2;
        // Title
        this.title = { 'episode': '', 'manga': '' }
        // Enum type
        this.type = type.undefined;
        // Vertical mode
        this.vertical = false;
        // WebRTC submodule
        this.webrtc = webrtc;
        this.webrtc.pc.onconnectionstatechange = this._webrtc_connect_callback.bind(this);
        this.webrtc.pc.ondatachannel = this._webrtc_dc_callback.bind(this);
        this.webrtc.ctrl.onmessage = this._webrtc_control_callback.bind(this);

        this._init_observer();
        this._observe_step();
        this._read_setting();
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

    get rtl() {
        return -this.ltr;
    }

    get URL() {
        return window.URL || window.webkitURL;
    }

    async open_manga() {
        const handle = await window.showDirectoryPicker().catch(err => {
            this._update();
            Notifier.info(preset.INFO_CANCELLED);
            return;
        });
        if (handle === undefined) return;
        controller = new Manga(handle, this.module, this.webrtc);
        await controller.init();
    }

    async open_episode() {
        const handle = await window.showDirectoryPicker().catch(err => {
            this._update();
            Notifier.info(preset.INFO_CANCELLED);
            return;
        });
        if (handle === undefined) return;
        controller = new Episode(handle, this.module, this.webrtc);
        await controller.init();
    }

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
            this._update();
            Notifier.info(preset.INFO_CANCELLED);
            return;
        });
        if (handle === undefined) return;
        controller = new Epub(handle, this.module, this.webrtc);
        await controller.init();
    }

    async open_webrtc() {
        // TODO: Working flow should be reconsidered
        if (!this.webrtc.connected) this.toggle_webrtc();
    }

    page_up() {
        this._page_move(-this.step);
        this._update();
    }

    page_down() {
        this._page_move(this.step);
        this._update();
    }

    page_drag(event) {
        this.cur = (event.target.value - 1) * 2;
        this._update();
    }

    page_arrowleft() {
        this._page_move(-this.ltr * this.step);
        this._update();
    }

    page_arrowright() {
        this._page_move(this.ltr * this.step);
        this._update();
    }

    scale_up() {
        if (this._to_fixed(this.ratio, 1) == 2) return;
        this.ratio += 0.1;
        this._scale();
        this._update_scale();
    }

    scale_down() {
        if (this._to_fixed(this.ratio, 1) == 0.5) return;
        this.ratio -= 0.1;
        this._scale();
        this._update_scale();
    }

    scale_reset() {
        this.ratio = 1;
        this._scale();
        this._update_scale();
    }

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

    async paste_text(span) {
        let input = span.children[0];
        input.select();
        // Clipboard API requires SECURE context, aka HTTPS connection or localhost
        // There is no way to fallback
        input.value = await navigator.clipboard?.readText();
        if (input.id == 'offer-provided') this.receive_offer();
        if (input.id == 'answer-replied') this.receive_answer();
    }

    toggle_contents() {
        document.getElementById('manga-contents').classList.toggle('hidden');
    }

    toggle_fullscreen() {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen();
        } else {
            if (document.exitFullscreen) {
                document.exitFullscreen();
            }
        }
    }

    toggle_webrtc() {
        let dialog = document.getElementById('dialog-webrtc');
        let elements = Array.from(dialog.getElementsByClassName('hidden')).concat(dialog);
        elements.forEach(element => (element.classList.toggle('hidden')));
        document.getElementById('dialog-close-webrtc').addEventListener('click', event => (
            elements.forEach(element => (element.classList.toggle('hidden')))
        ), { once: true });
    }

    toggle_help() {
        let dialog = document.getElementById('dialog-help');
        let elements = Array.from(dialog.getElementsByClassName('hidden')).concat(dialog);
        elements.forEach(element => (element.classList.toggle('hidden')));
        document.getElementById('dialog-close-help').addEventListener('click', event => (
            elements.forEach(element => (element.classList.toggle('hidden')))
        ), { once: true });
    }

    toggle_nav() {
        if (this.type == type.manga == document.getElementById('content-button').disabled) {
            Array.from(document.querySelectorAll('[data-navigator] button')).forEach(element => (
                element.disabled = !element.disabled
            ));
            document.getElementById('alt-previous-episode').disabled = this.type != type.manga;
            document.getElementById('alt-next-episode').disabled = this.type != type.manga;
        }
    }

    toggle_rotate(event) {
        if (this.rotate == this.rotate_flags.default) {
            this.rotate = this.rotate_flags.rotate_90_clockwise;
            this.toggle_single(true);
        } else {
            this.rotate = this.rotate_flags.default;
            this.toggle_single(false);
        }
    }

    toggle_settings() {
        document.getElementById('reader-setting').classList.toggle('hidden');
    }

    toggle_single() {
        const container = document.getElementById('images-container');
        container.classList.toggle('single-page');
        container.classList.toggle('double-page');
        this._update();
    }

    toggle_ui() {
        let ui = document.getElementById('reader-ui');
        if (ui.classList.contains('v-hidden')) {
            ui.classList.remove('v-hidden');
            ui.classList.add('autohide');
        } else {
            ui.classList.add('a-fade-out');
            ui.classList.remove('autohide');
        }
    }

    toggle_offset() {
        this.offset = (this.offset + 1) % 2;
        this._update();
    }

    toggle_rtl(value) {
        if (this.ltr != (value ? -1 : 1)) {
            document.getElementById('images-container').classList.toggle('use-rtl');
            document.getElementById('current-page').classList.toggle('left-position');
            document.getElementById('current-page').classList.toggle('right-position');
            document.getElementById('next-page').classList.toggle('left-position');
            document.getElementById('next-page').classList.toggle('right-position');
            document.getElementById('message-image-container').classList.toggle('flip');
            this._show_direction();
        }
        this.ltr = value ? -1 : 1;
        this._reset_hinter();
        if (this.type != type.undefined) this._update();
    }

    toggle_vertical(value, event) {
        if (this.vertical != value) {
            document.getElementById('reader-body').classList.toggle('horizontal-mode');
            document.getElementById('reader-body').classList.toggle('vertical-mode');
            this.vertical = value;
            this._reset_hinter();
        }
    }

    // WebRTC Signaling
    async create_offer() {
        let offer = document.getElementById('offer-generated');
        await this.webrtc.pc.setLocalDescription(await this.webrtc.pc.createOffer());
        this.webrtc.pc.onicecandidate = ({ candidate }) => {
            if (candidate) return;
            offer.value = this.webrtc.pc.localDescription.sdp;
            offer.select();
        };
    }

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

    receive_answer() {
        let answer = document.getElementById('answer-replied');
        if (this.webrtc.pc.signalingState != "have-local-offer") return;
        if (!answer.value.endsWith('\n')) answer.value += '\n';
        this.webrtc.pc.setRemoteDescription({ type: "answer", sdp: answer.value });
        this._webrtc_connecting();
    };

    async _load_files(handle) {
        for await (const [_, entry] of handle.entries()) {
            if (entry.kind === 'file') this.files.push(entry);
        };
        this.files.sort((a, b) => (a.name.localeCompare(b.name, {}, { numeric: true })));
    }

    async _file(index) {
        return this._rotate_wrapper(await this.files[index].getFile());
    }

    async _init_vertical() {
        let list = document.getElementById('image-list');
        Array.from(list.children).forEach(element => (
            list.removeChild(element)
        ));
        list.id = "image-list";
        list.classList.add('image-list', 'm-auto', 'over-hidden');
        for (const [index, handle] of this.files.entries()) {
            let image = document.createElement('img');
            image.dataset.index = index;
            this.observer['image'].observe(image);
            let container = document.createElement('div');
            container.classList.add('img-container', 'w-100', 'h-100');
            let item = document.createElement('div');
            item.dataset.index = index;
            item.classList.add('image-item', 'p-relative', 'unselectable');
            container.appendChild(image);
            item.appendChild(container);
            list.appendChild(item);
        }
    }

    _init_observer() {
        this.observer['image'] = new IntersectionObserver((entries, observer) => (
            entries.forEach(async entry => {
                if (entry.isIntersecting) {
                    const image = entry.target;
                    const index = parseInt(image.dataset.index, 10);
                    image.src = this.URL.createObjectURL(await this.files[index].getFile());
                    image.parentNode.parentNode.classList.add('image-loaded');
                    observer.unobserve(entry.target);
                }
            })
        ));
        this.observer['step'] = new IntersectionObserver((entries, observer) => (
            entries.forEach(entry => {
                controller.step = entry.intersectionRatio == 0 ? 1 : 2;
                // When step changes from 1 to 2, whatever this.offset is, this.cur should NOT BE odd
                // Or the first page becomes unreachable
                if (controller.step == 2 && controller.cur % 2) {
                    controller.cur += -2 * controller.offset + 1;
                    controller.toggle_offset();
                }
                // When step changes from 2 to 1, if this.offset is 1, this.cur should NOT BE 0
                // Or the first page becomes blank
                if (controller.step == 1 && controller.offset == 1 && controller.cur == 0) {
                    controller.cur = 1;
                }
                if (controller.type != type.undefined) controller._update();
                controller._reset_hinter();
            })
        ));
    }

    _observe_step() {
        const secondary = document.getElementById('image-secondary');
        this.observer['step'].observe(secondary);
    }

    async _rotate_wrapper(blob) {
        if (this.rotate >= 0) {
            let buffer = await blob.arrayBuffer();
            this.module.FS.writeFile('image', new Uint8Array(buffer));
            blob = new Blob([await this.module.rotate_image('image', this.rotate)]);
        }
        return blob;
    }

    async _update_images(e) {
        document.getElementById('image-primary').src = this._validate(this.pos.primary) ? this.URL.createObjectURL(await this._file(this.primary)) : '';
        if (this.step == 2) document.getElementById('image-secondary').src = this._validate(this.pos.secondary) ? this.URL.createObjectURL(await this._file(this.secondary)) : '';
        if (this.files.length == 0) Notifier.error(preset.ERR_NO_FILES);
    }

    _flush() {
        document.getElementById('image-primary').src = '';
        document.getElementById('image-secondary').src = '';
    }

    _loaded() {
        document.getElementById('loading-hinter').classList.add('hidden');
    }

    _loading() {
        document.getElementById('loading-hinter').classList.remove('hidden');
    }

    _ltr(pos = this.pos.primary) {
        return (((pos === this.pos.secondary) ? 1 : -1) * this.ltr + 1) / 2;
    }

    _page_check(after) {
        if (after - this.step % 2 * this.offset < 0) Notifier.error(preset.ERR_ALREADY_FIRST_PAGE)
        else if (after >= this.files.length + this.offset) Notifier.error(preset.ERR_ALREADY_LAST_PAGE);
        return after - this.step % 2 * this.offset >= 0 && after < this.files.length + this.offset;
    }

    _page_move(offset) {
        if (this.vertical) return;
        if (this._page_check(this.cur + offset)) this.cur += offset;
    }

    _read_setting() {
        Array.from(document.getElementById('reader-setting').querySelectorAll('button.selected')).forEach(element => {
            if (element.dataset.setting < 4) this.vertical = element.dataset.setting == 3;
            if (element.dataset.setting > 3) this.ltr = element.dataset.setting == 5 ? -1 : 1;
        });
    }

    _reset(full = false) {
        this.files = new Array();
        if (full) this.cur = 0;
    }

    _reset_hinter() {
        let hinter = document.getElementById('hinter-image');
        hinter.classList.remove('flip', 'rotate');
        hinter.parentNode.classList.remove('double', 'single');
        if (this.ltr == -1) hinter.classList.add('flip');
        if (this.step == 1 || this.vertical) hinter.parentNode.classList.add('single')
        else hinter.parentNode.classList.add('double');
        if (this.vertical) hinter.classList.add('rotate');
    }

    _reset_content() {
        document.getElementById('manga-contents').classList.add('hidden');
    }

    _show_direction() {
        document.getElementById('message-box').classList.remove('hidden');
        clearTimeout(this.message);
        this.message = setTimeout(() => (document.getElementById('message-box').classList.add('hidden')), 3000);
    }

    _scale() {
        let container = document.getElementById('images-container');
        let parent = container.parentNode;
        let list = document.getElementById('image-list');
        let button = document.getElementById('load-next-btn-container');

        // Horizontal scale
        Array.from(container.querySelectorAll('img')).forEach(element => (
            element.style.transform = `scale(${this.ratio})`
        ));
        if (this.ratio >= 1) {
            container.style.width = `${Math.round(this.ratio * 100)}%`;
            parent.scrollLeft = (parent.clientWidth / 2) * (this.ratio - 1);
        }
        // Vertical scale
        list.style.transform = `scale(${this.ratio})`;
        list.scrollIntoView();
        if (this.vertical) {
            let translate = list.clientHeight * (this.ratio - 1);
            button.style.transform = `translateY(${translate}px)`;
        }
    }

    _scroll_vertical_visibile(element) {
        let bounding = element.getBoundingClientRect();
        return (
            bounding.top <= (window.innerHeight || document.documentElement.clientHeight) &&
            bounding.bottom >= 0 &&
            this.vertical
        )
    };

    _to_fixed(value, float) {
        if (float <= 0 || Math.round(float) != float) throw { msg: 'Value must be an interger which is greater than 0.', value: float };
        return (Math.round(parseFloat(value) * 10 * float) / (10 * float));
    }

    _validate(pos = this.pos.primary) {
        return ((pos === this.pos.primary && this.primary >= 0 && this.primary < this.files.length) ||
            (pos === this.pos.secondary && this.secondary >= 0 && this.secondary < this.files.length)) && this.files.length > 0;
    }

    _update() {
        this._update_images();
        this._update_info();
        this._update_hinter();
        this._update_scale();
    }

    _update_hinter() {
        document.getElementById('current-page').innerHTML = !this._validate(this.pos.primary) ? '' : this.primary + 1;
        document.getElementById('next-page').innerHTML = !this._validate(this.pos.secondary) ? '' : this.secondary + 1;
        Array.from(document.getElementById('image-list').children).forEach(element => {
            if (this._scroll_vertical_visibile(element)) {
                document.getElementById('current-page').innerHTML = parseInt(element.dataset.index, 10) + 1;
                return;
            }
        })
    }

    _update_info() {
        let manga = document.getElementById('manga-title');
        manga.innerHTML = this.title['manga'];
        manga.title = this.title['manga'];
        let episode = document.getElementById('episode-title');
        episode.innerHTML = this.title['episode'];
        episode.title = this.title['episode'];
        document.getElementById('page-count').innerHTML = this.files.length || '';
        this._update_progress(Math.floor((this.cur + this.offset) / 2) + 1, Math.round((this.files.length + this.offset) / 2));
        // TODO: Change to logged location [Low priority]
    }

    _update_progress(value, max) {
        document.getElementsByClassName('progress-indicator')[0].innerHTML = `${value} / ${max}`;
        let progress = document.getElementById('progress-indicator');
        progress.value = value;
        progress.max = max;
    }

    _update_scale() {
        document.getElementById('scale-percentage').innerHTML = `${Math.round(this.ratio * 100)}%`;
    }

    _webrtc_connecting() {
        document.querySelectorAll('[id^="answer"]').forEach(element => (
            element.parentNode.classList.add('loading')
        ));
    }

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
                if (this.client) controller = new WebRTCClient(this.module, this.webrtc);
                Notifier.info(preset.INFO_WEBRTC_CONNECTED);
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
        if (channel.label == 'file') this.webrtc.channels.set(channel.id, channel);
    }

    async _webrtc_control_callback(event) {
        let msg = JSON.parse(event.data);
        if (msg.target == this.webrtc.target.client) return;
        switch(msg.cmd) {
            case 'episode':
                this._webrtc_reply_episode(msg.args);
                break;
            case 'fetch':
                await this._webrtc_reply_file(msg.args);
                break;
            default:
                console.error('Unexpected command.')
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
        };
        switch (this.type) {
            case type.manga:
                let files = new Array();
                for await (const [_, entry] of this.episodes[args.index].entries()) {
                    if (entry.kind === 'file') files.push(entry);
                };
                episode.name = this.episodes[args.index].name;
                episode.length = files.length;
                break;
            case type.episode:
            case type.epub:
                episode.name = this.title['episode'];
                episode.length = this.files.length;
                break;
        }
        this.webrtc.scope = args.index;
        this.webrtc.cmd('episode', this.webrtc.target.client, episode);
    }

    async _webrtc_reply_file(args) {
        let file = null;
        let data = null;
        switch (this.type) {
            case type.manga:
                let files = new Array();
                for await (const [_, entry] of this.episodes[args.scope].entries()) {
                    if (entry.kind === 'file') files.push(entry);
                };
                files.sort((a, b) => (a.name.localeCompare(b.name, {}, { numeric: true })));
                file = await files[args.index].getFile();
                data = await file.arrayBuffer();
                break;
            case type.episode:
            case type.epub:
                file = await this.files[args.index].getFile();
                data = await file.arrayBuffer();
                break;
        }
        this.webrtc._transmit_file(data, args.channel);
    }

    _webrtc_transmit_meta() {
        if (this.webrtc.pc.connectionState != 'connected') return;
        let meta = {
            manga: this.title.manga,
            episode: this.title.episode,
            type: this.type,
            episodes: this.episodes ? this.episodes.map(episode => ({name: episode.name})) : null,
        };
        this.webrtc._transmit_meta(meta);
    }
}

class Episode extends Base {
    constructor(handle, module, webrtc) {
        super(module, webrtc);
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

    async load() {
        this._reset();
        this.title['episode'] = this.handle.name;
        await this._load_files(this.handle);
        this.toggle_nav();
        this._update();
        this._reset_content();
        this._init_vertical();
        this._webrtc_transmit_meta();
    }
}

class Manga extends Base {
    constructor(handle, module, webrtc) {
        super(module, webrtc);
        // Episode list
        this.episodes = new Array();
        // Episode index
        this.index = 0;
        // Root directory file handle
        this.root = handle;
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

    async load() {
        let tmp = new Array();
        for await (const [_, entry] of this.root.entries()) {
            if (entry.kind === 'directory') tmp.push(entry);
        };
        tmp.sort((a, b) => (a.name.localeCompare(b.name, {}, { numeric: true })));
        if (tmp.length != 0) this.episodes = tmp;
        await this._episode_move(0);
        this.toggle_nav();
        this._update();
        this._init_contents();
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
            await this._load_files(this.episodes[this.index]);
            this._init_vertical();
            if (this.vertical) this._scale();
        } else if (this.index + offset < 0) {
            Notifier.error(preset.ERR_ALREADY_FIRST_EPISODE);
        } else if (this.index + offset >= this.episodes.length) {
            Notifier.error(preset.ERR_ALREADY_LAST_EPISODE);
        }
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

class Epub extends Episode {
    constructor(handle, module, webrtc) {
        super(handle, module, webrtc);
        // Type definition
        this.type = type.epub;
    }

    async init() {
        await this.load();
        Notifier.info(preset.INFO_EPUB_LOADED);
        if (this.files.length == 0) Notifier.error(preset.ERR_NO_FILES);
    }

    async load() {
        this._flush();
        this._loading();
        const file = await this.handle.getFile();
        let buffer = await file.arrayBuffer();
        this.module.FS.writeFile('tmp.epub', new Uint8Array(buffer)); // Unicode filename not supported
        this.api.epub_open('tmp.epub');
        this.title['episode'] = this.handle.name;
        this._load_files();
        this.toggle_nav();
        this._update();
        this._reset_content();
        this._init_vertical();
        this._webrtc_transmit_meta();
    }

    _load_files() {
        this.files = Array(this.api.epub_count()).fill().map((_, i) => ({ getFile: async _ => (new Blob([await this.module.epub_image(i)])) }));
    }
}

class WebRTC {
    constructor() {
        const config = { iceServers: [] };
        this.pc = new RTCPeerConnection(config);
        this.ctrl = this.pc.createDataChannel("ctrl", { negotiated: true, id: 0 });
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

    cmd(cmd, target, args=null) {
        if (this.ctrl.readyState != 'open') return;
        this.ctrl.send(JSON.stringify({ cmd: cmd, target: target, args: args }));
    }

    async file(index) {
        if (this.client) return;
        let rx = this.pc.createDataChannel('file');
        let buffer = new Array();
        let meta = null;
        let size = 0;
        rx.onopen = (event) => {
            this.channels.set(rx.id, rx);
            rx.binaryType = 'arraybuffer';
            let args = {
                scope: this.scope,
                index: index,
                channel: rx.id,
            };
            this.cmd('fetch', this.target.host, args);
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
        rx.onerror = (event) => (console.error(event.data));
        rx.onclosing = (event) => (this.channels.delete(rx.id));
        return new Promise((resolve) => (
            rx.onclose = (event) => {
                resolve(buffer);
            }
        ));
    }

    _transmit_file(data, channel) {
        let offset = 0;
        let tx = this.channels.get(channel);
        if (tx.readyState != 'open') console.error('Datachannel not ready.');
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

class WebRTCClient extends Base {
    constructor(module, webrtc) {
        super(module, webrtc);
        // WebRTC Client
        this.client = true;
        // Episode list
        this.episodes = new Array();
        // Episode index
        this.index = 0;
        // Episode promise resolve
        this.resolve;
    }

    get sync() {
        // return this.type == type.manga ? Manga.prototype.sync : Episode.prototype.sync;
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
        return this.type == type.manga ? Manga.prototype.page_up : Episode.prototype.page_up;
    }

    get page_down() {
        return this.type == type.manga ? Manga.prototype.page_down : Episode.prototype.page_down;
    }

    get page_arrowleft() {
        return this.type == type.manga ? Manga.prototype.page_arrowleft : Episode.prototype.page_arrowleft;
    }

    get page_arrowright() {
        return this.type == type.manga ? Manga.prototype.page_arrowright : Episode.prototype.page_arrowright;
    }

    get _page_move() {
        return this.type == type.manga ? Manga.prototype._page_move : Episode.prototype._page_move;
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
                this._update();
                break;
            case type.episode:
            case type.epub:
                await this._load_files(this.index);
                this.title['episode'] = this.meta.episode;
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
            await this._load_files(this.index);
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
                console.error('Unexpected command.')
        }
    }

    async _webrtc_request_episode(index) {
        let args = {
            index: index,
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
        this.files = Array(args.length).fill().map((_, i) => ({ getFile: async _ => (new Blob(await this.webrtc.file(i))) }));
        this.resolve();
    }

    async _load_files(index) {
        await this._webrtc_request_episode(index);
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
                this.title['episode'] = this.meta.episode || '';
                break;
        }
        super._update_info();
    }
}

class Notifier {
    constructor() {
        this.timer = null;
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

    static _toast(msg) {
        this._clear();
        document.getElementById('toast-content').innerHTML = msg;
        document.getElementById('episode-toast').classList.remove('hidden');
        this.timer = setTimeout(() => (document.getElementById('episode-toast').classList.add('hidden')), 3000);
    }

    static _clear() {
        window.clearTimeout(this.timer);
        document.getElementById('episode-toast').classList.add('hidden');
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

    ERR_ALREADY_FIRST_PAGE: '已经是第一页了',
    ERR_ALREADY_LAST_PAGE: '已经是最后一页了',
    ERR_ALREADY_FIRST_EPISODE: '没有上一话了',
    ERR_ALREADY_LAST_EPISODE: '没有下一话了',
    ERR_NO_FILES: '没有可显示的图片',
    ERR_NO_EPISODES: '没有可显示的章节',

    CUSTOM: null
});

const type = Object.freeze({
    undefined: 0,
    epub: 1,
    episode: 1,
    manga: 2
});

let controller = null;

window.addEventListener('DOMContentLoaded', () => init());

let init = () => {
    let ui = document.getElementById('reader-ui');
    let body = document.getElementById('reader-body');
    let container = document.getElementById('ps-container');
    ui.addEventListener('animationend', event => {
        if (event.animationName == 'fade-out') {
            event.target.classList.add('v-hidden');
            event.target.classList.remove('a-fade-out');
        } else if (event.animationName == 'delayed-move-out-top' || event.animationName == 'delayed-move-out-bottom') {
            event.target.parentNode.classList.add('v-hidden');
            event.target.parentNode.classList.remove('autohide');
        }
    });
    ui.addEventListener('mouseleave', event => (
        event.target.classList.add('autohide')
    ));
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
                '0': () => (controller.toggle_single(false)),
                '1': () => (controller.toggle_single(true)),
                '2': () => (controller.toggle_vertical(false, event)),
                '3': () => (controller.toggle_vertical(true, event)),
                '4': () => (controller.toggle_rtl(false)),
                '5': () => (controller.toggle_rtl(true)),
            }
            callbacks[event.target.dataset.setting]();
            if (!(event.target.disabled || event.target.classList.contains('selected'))) {
                Array.from(event.target.parentNode.children).forEach(element => {
                    element.classList.toggle('selected');
                });
            }
        })
    ));
    container.addEventListener('scroll', event => (
        controller._update_hinter()
    ));
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
    Module().onRuntimeInitialized = async _ => {
        controller = new Base(Module(), new WebRTC());
        controller._show_direction();
        controller.create_offer();
    };
};
