const badges = Object.freeze({
    MangaNative:   { name: 'Manga Native',   color: 'hsl(25, 100%, 65%)' },
    Signaling:     { name: 'Signaling',      color: 'hsl(46, 100%, 50%)' },
    Sector:        { name: 'Sector',         color: 'hsl(59, 70%, 60%)' },
    Firebase:      { name: 'Firebase',       color: 'hsl(71, 65%, 60%)' },
    ServiceWorker: { name: 'Service Worker', color: 'hsl(205, 100%, 65%)' },
    WebRTC:        { name: 'WebRTC',         color: 'hsl(266, 60%, 75%)'},
});

class Badge {
    static args(...badges) {
        const text_color = '#FFFFFF';
        const names = badges.map(badge => `%c${badge.name}`);
        const values = badges.map(badge => `background-color: ${badge.color}; color: ${text_color}; padding: 2px 4px; border-radius: 4px;`);
        return Array.prototype.concat(names.join(''), values);
    }
}