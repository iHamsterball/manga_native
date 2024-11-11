const badges = Object.freeze({
    Debug:         [{ name: 'Debug', color: '#5165F6' }],
    MangaNative:   [{ name: 'Manga Native', color: '#E66000' }],
    Signaling:     [{ name: 'Signaling', color: '#CECC0C' },
                    { name: 'Firebase', color: '#FFC400' }],
    ServiceWorker: [{ name: 'Service Worker', color: '#32AAFF' }],
    WebRTC:        [],
});

class Badge {
    static args(badges) {
        const text_color = '#FFFFFF';
        const names = badges.map(badge => `%c${badge.name}`);
        const values = badges.map(badge => `background-color: ${badge.color}; color: ${text_color}; padding: 2px 4px; border-radius: 4px;`);
        return Array.prototype.concat(names.join(''), values);
    }
}