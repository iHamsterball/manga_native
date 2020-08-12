class Base {
    constructor(module) {
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
        // Current page & offset
        this.cur = this.offset = 0;
        // File list
        this.files = new Array();
        // Enum image container
        this.pos = Object.freeze({
            primary: Symbol('primary'),
            secondary: Symbol('secondary')
        });
        // Right-to-Left Order (Left-to-Right -1)
        this.ltr = -1;
        // Wasm module
        this.module = module;
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
        this.type = Object.freeze({
            epub: false,
            episode: false,
            manga: true
        });
        // Vertical mode
        this.vertical = false;

        this._read_setting();
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
        controller = new Manga(this.module);
        await controller.open();
    }

    async open_episode() {
        controller = new Eposide(this.module);
        await controller.open();
    }

    async open_epub() {
        controller = new Epub(this.module);
        await controller.open();
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

    toggle_help() {
        let dialog = document.getElementById('dialog-layout');
        let elements = Array.from(dialog.getElementsByClassName('hidden')).concat(dialog);
        elements.forEach(element => (element.classList.toggle('hidden')));
        document.getElementById('dialog-close').addEventListener('click', event => (
            elements.forEach(element => (element.classList.toggle('hidden')))
        ), { once: true });
    }

    toggle_nav(mask) {
        if (mask == document.getElementById('content-button').disabled) {
            Array.from(document.querySelectorAll('[data-navigator] button')).forEach(element => (
                element.disabled = !element.disabled
            ));
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

    toggle_single(value) {
        if (this.step != (value ? 1 : 2)) {
            document.getElementById('images-container').classList.toggle('double-page');
            document.getElementById('images-container').classList.toggle('single-page');
            this.step = (this.step % 2) + 1;
            this.offset = 0;
            this._reset_hinter();
            this._update();
        }
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
        this._update();
    }

    toggle_vertical(value, event) {
        if (this.vertical != value) {
            document.getElementById('reader-body').classList.toggle('horizontal-mode');
            document.getElementById('reader-body').classList.toggle('vertical-mode');
            this.vertical = value;
            this._reset_hinter();
        }
    }

    async _load_files(handle) {
        const entries = await handle.getEntries();
        for await (const entry of entries) {
            if (entry.isFile) this.files.push(entry);
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
            image.src = this.URL.createObjectURL(await handle.getFile());
            image.addEventListener('load', () => (this._scale()));
            let container = document.createElement('div');
            container.classList.add('img-container', 'w-100', 'h-100');
            let item = document.createElement('div');
            item.dataset.index = index;
            item.classList.add('image-item', 'p-relative', 'image-loaded', 'unselectable');
            container.appendChild(image);
            item.appendChild(container);
            list.appendChild(item);
        }
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
        if (after < 0) Notifier.error(preset.ERR_ALREADY_FIRST_PAGE)
        else if (after >= this.files.length + this.offset) Notifier.error(preset.ERR_ALREADY_LAST_PAGE);
        return after >= 0 && after < this.files.length + this.offset;
    }

    _page_move(offset) {
        if (this._page_check(this.cur + offset)) this.cur += offset;
    }

    _read_setting() {
        Array.from(document.getElementById('reader-setting').querySelectorAll('button.selected')).forEach(element => {
            if (element.dataset.setting < 4) this.vertical = element.dataset.setting == 3;
            if (element.dataset.setting > 3) this.ltr = element.dataset.setting == 5 ? -1 : 1;
        });
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
        setTimeout(() => (document.getElementById('message-box').classList.add('hidden')), 3000);
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
}

class Eposide extends Base {
    constructor(module) {
        super(module);
    }

    async open() {
        const opts = { type: 'open-directory' };
        const handle = await window.chooseFileSystemEntries(opts).catch(err => {
            this._update();
            Notifier.info(preset.INFO_CANCELLED);
            return;
        });
        if (handle === undefined) return;
        await this._load_files(handle);
        this.title['episode'] = handle.name;
        this.toggle_nav(this.type.episode);
        Notifier.info(preset.INFO_EPISODE_LODED);
        this._update();
        this._reset_content();
        this._init_vertical();
        if (this.files.length == 0) Notifier.error(preset.ERR_NO_FILES);
    }
}

class Manga extends Base {
    constructor(module) {
        super(module);
        // Eposide list
        this.episodes = new Array();
        // Eposide index
        this.index = 0;
        // Root directory file handle
        this.root = null;
    }

    async open() {
        let tmp = new Array();
        const opts = { type: 'open-directory' };
        const handle = await window.chooseFileSystemEntries(opts).catch(err => {
            this._update();
            Notifier.info(preset.INFO_CANCELLED);
            return;
        });
        if (handle === undefined) return;
        const entries = await handle.getEntries();
        for await (const entry of entries) {
            if (entry.isDirectory) tmp.push(entry);
        };
        tmp.sort((a, b) => (a.name.localeCompare(b.name, {}, { numeric: true })));
        if (tmp.length != 0) this.episodes = tmp;
        this.root = handle;
        await this._episode_move(0);
        this.toggle_nav(this.type.manga);
        this._init_contents();
        this._update();
        Notifier.info(preset.INFO_MANGA_LOADED);
        if (tmp.length == 0) Notifier.error(preset.ERR_NO_EPISODES);
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
        await this._page_move(parseInt(event.target.dataset.index, 10) - this.index);
        this._update();
    }

    async episode_scrolldown() {
        await this._episode_move(1);
        this._scale();
        this._update();
    }

    async page_up() {
        await this._page_move(-1, this.step);
        this._update();
    }

    async page_down() {
        await this._page_move(1, this.step);
        this._update();
    }

    async page_arrowleft() {
        await this._page_move(-this.ltr, this.step);
        this._update();
    }

    async page_arrowright() {
        await this._page_move(this.ltr, this.step);
        this._update();
    }

    async _episode_move(offset) {
        if (offset == -1) Notifier.info(preset.INFO_PREVIOUS_EPISODE);
        if (offset == 1) Notifier.info(preset.INFO_NEXT_EPISODE);
        if (this._episode_check(this.index + offset)) {
            this.index += offset;
            this._reset();
            await this._load_files(this.episodes[this.index]);
        } else if (this.index + offset < 0) {
            Notifier.error(preset.ERR_ALREADY_FIRST_EPISODE);
        } else if (this.index + offset >= this.episodes.length) {
            Notifier.error(preset.ERR_ALREADY_LAST_EPISODE);
        }
        this._init_vertical();
    }

    async _page_move(r, s) {
        if (this._page_check(this.cur + r * s)) {
            this.cur += r * s;
        } else {
            await this._episode_move(r);
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

    _reset() {
        this.files = new Array();
        this.cur = 0;
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

class Epub extends Eposide {
    constructor(module) {
        super(module);
        // Vertical initialization status
        this.initialized = false;
    }

    async open() {
        const opts = {
            type: 'open-file',
            accepts: [{ extensions: ['epub'] }]
        };
        const handle = await window.chooseFileSystemEntries(opts).catch(err => {
            this._update();
            Notifier.info(preset.INFO_CANCELLED);
            return;
        });
        if (handle === undefined) return;
        this._flush();
        this._loading();
        const file = await handle.getFile();
        let buffer = await file.arrayBuffer();
        this.module.FS.writeFile('tmp.epub', new Uint8Array(buffer)); // Unicode filename not supported
        this.api.epub_open('tmp.epub');
        if (handle === undefined) return;
        this.title['episode'] = handle.name;
        this._load_files();
        this.toggle_nav(this.type.epub);
        Notifier.info(preset.INFO_EPISODE_LODED);
        this._update();
        this._reset_content();
        // this._init_vertical();
        if (this.files.length == 0) Notifier.error(preset.ERR_NO_FILES);
    }

    toggle_vertical(value, event) {
        if (!this.initialized) this._init_vertical();
        super.toggle_vertical(value, event);
    }

    _load_files() {
        this.files = Array(this.api.epub_count()).fill().map((_, i) => new EpubFileHandle(this.module.epub_image, i));
    }

    _page_move(offset) {
        if (this._page_check(this.cur + offset)) this.cur += offset;
    }
}

class EpubFileHandle {
    constructor(func, index) {
        this.func = func;
        this.index = index;
    }

    async getFile () {
        return new Blob([await this.func(this.index)]);
    }
}

class Notifier {
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
        document.getElementById('toast-content').innerHTML = msg;
        document.getElementById('episode-toast').classList.remove('hidden');
        setTimeout(() => (document.getElementById('episode-toast').classList.add('hidden')), 3000);
    }
}

const preset = Object.freeze({
    INFO_CANCELLED: '已取消选择',
    INFO_EPISODE_LODED: '加载章节成功',
    INFO_MANGA_LOADED: '加载漫画成功',
    INFO_PREVIOUS_EPISODE: '已切换到上一话',
    INFO_NEXT_EPISODE: '已切换至下一话',

    ERR_ALREADY_FIRST_PAGE: '已经是第一页了',
    ERR_ALREADY_LAST_PAGE: '已经是最后一页了',
    ERR_ALREADY_FIRST_EPISODE: '没有上一话了',
    ERR_ALREADY_LAST_EPISODE: '没有下一话了',
    ERR_NO_FILES: '没有可显示的图片',
    ERR_NO_EPISODES: '没有可显示的章节',

    CUSTOM: null
});

let controller = null;

window.addEventListener('DOMContentLoaded', () => init());

let init = () => {
    let ui = document.getElementById('reader-ui');
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
            document.getElementById('reader-body').classList.add('arrow-left');
            document.getElementById('reader-body').classList.remove('arrow-right');
        } else {
            document.getElementById('reader-body').classList.remove('arrow-left');
            document.getElementById('reader-body').classList.add('arrow-right');
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
        if ((event.pageX < (window.innerWidth / 2)) == (controller.rtl == 1)) {
            controller.page_down();
        } else {
            controller.page_up();
        }
    });
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
        controller = new Base(Module());
        controller._show_direction();
    };
};
