importScripts('/js/badge.js');

self.onmessage = async (event) => {
    const start = performance.now();
    const { buffer, type, rotate } = event.data;

    // flag 0/1/2 → EXIF Orientation
    // 0 = 90° Clockwise → 6
    // 1 = 180° Clockwise → 3
    // 2 = 270° Clockwise → 8
    const orientation_map = [6, 3, 8];
    const orientation = orientation_map[rotate];

    // flag 0/1/2 → degrees
    const degrees_map = [90, 180, 270];
    const degrees = degrees_map[rotate];

    try {
        if (["image/jpeg", "image/jpg"].includes(type)) {
            try {
                const view = new DataView(buffer);
                if (view.getUint16(0) !== 0xFFD8) return;
                console.info(...Badge.args(badges.MangaNative, badges.Rotator), 'JPEG file detected.');

                // Modify Orientation tag in existing EXIF segment
                let offset = 2;
                const length = view.byteLength;

                while (offset < length - 4) {
                    const marker = view.getUint16(offset);
                    if ((marker & 0xFF00) !== 0xFF00) break;

                    const segment_length = view.getUint16(offset + 2);

                    if (marker === 0xFFE1) {
                        const exif_start = offset + 4;
                        // Exif\0\0
                        if (view.getUint32(exif_start) === 0x45786966 &&
                            view.getUint16(exif_start + 4) === 0x0000) {
                            const tiff_start = exif_start + 6;
                            const little_endian = view.getUint16(tiff_start) === 0x4949;
                            const ifd0_offset = view.getUint32(tiff_start + 4, little_endian);
                            const ifd0 = tiff_start + ifd0_offset;
                            const entries = view.getUint16(ifd0, little_endian);

                            for (let i = 0; i < entries; i++) {
                                const entry = ifd0 + 2 + i * 12;
                                const tag = view.getUint16(entry, little_endian);
                                if (tag === 0x0112) {
                                    // Orientation tag found, overwrite value
                                    view.setUint16(entry + 8, orientation, little_endian);
                                    self.postMessage({ value: buffer, type }, [buffer]);

                                    const duration = performance.now() - start;
                                    console.info(...Badge.args(badges.MangaNative, badges.Rotator), 'Orientation tag modified.');
                                    console.info(...Badge.args(badges.MangaNative, badges.Rotator), 'Time consumed:', `${duration.toFixed(2)}ms`);
                                    return;
                                }
                            }
                        }
                    }
                    offset += 2 + segment_length;
                }

                // No Orientation tag found, insert minimal APP1
                console.info(...Badge.args(badges.MangaNative, badges.Rotator), 'No EXIF Orientation tag found.');
                const exif = new Uint8Array([
                    0xFF, 0xE1,                                                // FF E1             APP1 marker
                    0x00, 0x22,                                                // 00 22             length 34
                    0x45, 0x78, 0x69, 0x66, 0x00, 0x00,                        // 45 78 69 66 00 00 "Exif\0\0"
                    0x49, 0x49,                                                // 49 49             little endian
                    0x2A, 0x00,                                                // 2A 00             magic 42
                    0x08, 0x00, 0x00, 0x00,                                    // 08 00 00 00       IFD0 offset
                    0x01, 0x00,                                                // 01 00             one entry
                    0x12, 0x01,                                                // 12 01             tag Orientation
                    0x03, 0x00,                                                // 03 00             type SHORT
                    0x01, 0x00, 0x00, 0x00,                                    // 01 00 00 00       count 1
                    orientation & 0xFF, (orientation >> 8) & 0xFF, 0x00, 0x00, // xx 00 00 00       value
                    0x00, 0x00, 0x00, 0x00                                     // 00 00 00 00       next IFD
                ]);

                const result = new Uint8Array(2 + exif.length + (buffer.byteLength - 2));
                result.set(new Uint8Array(buffer, 0, 2), 0);
                result.set(exif, 2);
                result.set(new Uint8Array(buffer, 2), 2 + exif.length);

                const output = result.buffer.slice(result.byteOffset, result.byteOffset + result.byteLength);
                self.postMessage({ value: output, type }, [output]);

                const duration = performance.now() - start;
                console.info(...Badge.args(badges.MangaNative, badges.Rotator), 'Minimal APP1 segment inserted.');
                console.info(...Badge.args(badges.MangaNative, badges.Rotator), 'Time consumed:', `${duration.toFixed(2)}ms`);
                return;
            } catch (error) {
                console.warn(...Badge.args(badges.MangaNative, badges.Rotator), "EXIF bytes manipulation failed:", error);
            }
        }

        // Fallback using OffscreenCanvas
        const source = new Blob([buffer], { type });
        const bitmap = await createImageBitmap(source);

        const radian = degrees * Math.PI / 180;
        const swap = degrees % 180 !== 0;

        const canvas = new OffscreenCanvas(
            swap ? bitmap.height : bitmap.width,
            swap ? bitmap.width : bitmap.height
        );
        const context = canvas.getContext("2d");
        context.translate(canvas.width / 2, canvas.height / 2);
        context.rotate(radian);
        context.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2);
        bitmap.close();

        const output = canvas.transferToImageBitmap();
        self.postMessage({ value: output, type }, [output]);

        const duration = performance.now() - start;
        console.info(...Badge.args(badges.MangaNative, badges.Rotator), 'Image rotated via OffscreenCanvas.');
        console.info(...Badge.args(badges.MangaNative, badges.Rotator), 'Time consumed:', `${duration.toFixed(2)}ms`);
    } catch (error) {
        self.postMessage({ error: error.message || String(error) });
    }
};
