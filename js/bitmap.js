self.onmessage = async (event) => {
    const { blob } = event.data;

    // Create an ImageBitmap directly from the Blob
    const bitmap = await createImageBitmap(blob);

    // Create an OffscreenCanvas with the image's natural dimensions
    const offscreenCanvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = offscreenCanvas.getContext('bitmaprenderer');
    context.transferFromImageBitmap(bitmap);

    // Transfer the prepared bitmap back to the main thread
    const bitmapToTransfer = offscreenCanvas.transferToImageBitmap();
    self.postMessage({ bitmap: bitmapToTransfer }, [bitmapToTransfer]);
};