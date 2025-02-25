const { TelegramClient } = require("telegram");
const { StringSession } = require("telegram/sessions");
const fs = require("fs");
const path = require("path");
const admin = require("firebase-admin");
const prompt = require("prompt-sync")();


const serviceAccount = require("./firebase-key.json");
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    storageBucket: "gs://tg-autopost.firebasestorage.app",
});
const db = admin.firestore();
const bucket = admin.storage().bucket();

const config = JSON.parse(fs.readFileSync("config.json", "utf8"));
const apiId = config.api_id;
const apiHash = config.api_hash;
const forwardChatId = BigInt(config.forward_chat_id);
const channelIds = new Set(config.channels.map(id => BigInt(id)));

let session = new StringSession("");
if (fs.existsSync("session.json")) {
    session = new StringSession(fs.readFileSync("session.json", "utf8"));
}

const client = new TelegramClient(session, apiId, apiHash, { connectionRetries: 5 });

async function uploadToFirebase(localFilePath, fileName) {
    const file = bucket.file(`telegram_images/${fileName}`);
    await file.save(fs.readFileSync(localFilePath), { public: true });
    const publicUrl = `https://storage.googleapis.com/${bucket.name}/${file.name}`;

    console.log("Файл доступний за адресою:", publicUrl);

    return `https://storage.googleapis.com/${bucket.name}/telegram_images/${fileName}`;

}

(async () => {
    await client.start({
        phoneNumber: () => prompt("Введи номер телефону: "),
        password: () => prompt("Введи пароль (якщо є): "),
        phoneCode: () => prompt("Введи код з Telegram: "),
        onError: (err) => console.log(err),
    });

    console.log("✅ Бот підключений!");
    fs.writeFileSync("session.json", client.session.save());
    console.log("📡 Слухаємо канали...");

    client.addEventHandler(async (update) => {
        if (update.className === "UpdateNewChannelMessage") {
            const message = update.message;
            if (!message || !message.peerId || !message.peerId.channelId) return;

            const rawChannelId = message.peerId.channelId;
            const formattedChannelId = BigInt(`-100${rawChannelId}`);
            if (channelIds.has(formattedChannelId)) {
                console.log(`📩 Нове повідомлення з каналу ${formattedChannelId}`);

                let mediaUrl = null;

                const filePath = path.join(__dirname, "downloads", `${message.id}.jpg`);

                if (!fs.existsSync(filePath)) {
                    console.log(`❌ Файл ${filePath} не існує!`);
                } else {
                    console.log(`✅ Файл знайдено: ${filePath}`);
                }

                if (message.media && message.media.photo) {
                    const filePath = `./downloads/${message.id}.jpg`;

                    const result = await client.downloadMedia(message.media, { file: filePath });
                    fs.writeFileSync(filePath, result);
                    if (result) {
                        console.log(`✅ Файл успішно завантажений: ${filePath}`);
                        console.log(result);
                    } else {
                        console.log(`❌ Помилка! Telegram повернув пустий результат.`);
                    }

                    mediaUrl = await uploadToFirebase(filePath, `${message.id}.jpg`);
                    fs.unlinkSync(filePath);
                }

                const counterRef = db.collection("counters").doc("posts");
                const counterDoc = await counterRef.get();
                let lastIndexId = 0;
                if (counterDoc.exists) {
                    lastIndexId = counterDoc.data().lastIndexId + 1;
                }
                await counterRef.set({ lastIndexId });
                const postRef = db.collection("telegram_posts").doc(lastIndexId.toString());

                await postRef.set({
                    indexId: lastIndexId, // Автоінкрементоване ID
                    chatId: formattedChannelId.toString(),
                    postId: message.id, // Оригінальний Telegram ID
                    text: message.message || "",
                    media: mediaUrl ? { type: "photo", url: mediaUrl } : null,
                    createdAt: admin.firestore.FieldValue.serverTimestamp(),
                });


                // await db.collection("telegram_posts").doc(`${message.id}`).set({
                //     id: message.id,
                //     chatId: formattedChannelId.toString(),
                //     text: message.message || "",
                //     media: mediaUrl ? { type: "photo", url: mediaUrl } : null,
                //     timestamp: admin.firestore.Timestamp.now(),
                // });

                await client.sendMessage(forwardChatId, {
                    message: message.message,
                    entities: message.entities,
                    ...(mediaUrl && { media: message.media })
                });

                console.log("✅ Повідомлення відправлено і збережено в Firebase!");
            }
        }
    });
})();
