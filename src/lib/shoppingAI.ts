/**
 * SHOPPING AI: Brain-as-a-Service (Gemini Vision)
 * 
 * High-precision receipt extraction using Google Gemini 1.5.
 */

// Downscale images locally before sending to server to save bandwidth/latency
const downscaleImage = (base64: string, maxDim: number = 2048): Promise<string> => {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      let scale = 1;
      if (img.width > maxDim || img.height > maxDim) {
        scale = maxDim / Math.max(img.width, img.height);
      }
      canvas.width = img.width * scale;
      canvas.height = img.height * scale;
      const ctx = canvas.getContext('2d');
      if (!ctx) return resolve(base64);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', 0.8));
    };
    img.onerror = () => resolve(base64);
    img.src = base64.includes('base64,') ? base64 : `data:image/png;base64,${base64}`;
  });
};

export const extractReceiptData = async (base64Image: string) => {
  try {
    // 1. Local prep (Downscale to avoid 10MB payloads)
    const processedImage = await downscaleImage(base64Image);

    // 2. Server-side Vision Extraction
    const response = await fetch("/api/extract", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: processedImage }),
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error || "Server failed to process receipt");
    }

    const data = await response.json();
    
    // Ensure fallback values and return standard schema
    return {
      storeName: data.storeName || "Unknown Store",
      items: (data.items || []).map((item: any) => ({
        ...item,
        price: Number(item.price) || 0,
        quantity: Number(item.quantity) || 1,
        category: item.category || "Groceries",
        brand: item.brand || "",
        size: item.size || ""
      })),
      total: Number(data.total) || 0,
      date: data.date || new Date().toISOString().split('T')[0],
      time: data.time || "00:00",
      storeAddress: data.storeAddress || "",
      _usage: data._usage
    };
  } catch (error) {
    console.error("Shopping AI Error:", error);
    throw error; // Let the UI handle the error state
  }
};
