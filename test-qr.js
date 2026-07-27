import qrcode from "qrcode";

console.log("QR Code package loaded:", typeof qrcode);
console.log("QR Code exports:", Object.keys(qrcode));

const url = "https://backend-five-alpha-39.vercel.app/";
qrcode.toDataURL(url)
    .then(dataUrl => {
        console.log("QR Code generated successfully!");
        console.log("Data URL length:", dataUrl.length);
        console.log("First 100 chars:", dataUrl.substring(0, 100));
    })
    .catch(err => {
        console.error("Error:", err);
    });
