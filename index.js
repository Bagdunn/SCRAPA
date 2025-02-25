const { TelegramClient } = require("telegram");
const { StringSession } = require("telegram/sessions");
const fs = require("fs");
const path = require("path");
const admin = require("firebase-admin");
const axios = require("axios"); // Додали axios для запиту в OpenAI
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
const openaiApiKey = config.openai_api_key; // Додаємо ключ OpenAI

let session = new StringSession("");
if (fs.existsSync("session.json")) {
    session = new StringSession(fs.readFileSync("session.json", "utf8"));
}

const client = new TelegramClient(session, apiId, apiHash, { connectionRetries: 5 });

async function uploadToFirebase(localFilePath, fileName) {
    const file = bucket.file(`telegram_images/${fileName}`);
    await file.save(fs.readFileSync(localFilePath), { public: true });
    return `https://storage.googleapis.com/${bucket.name}/telegram_images/${fileName}`;
}

// 🧠 Запит в OpenAI для фільтрації + визначення назви проєкту
async function filterPostWithAI(text) {
    try {
        const response = await axios.post("https://api.openai.com/v1/chat/completions", {
            model: "gpt-4o-mini",
            messages: [{ role: "system", content: "Аналізуй текст і поверни назву проєкту, якщо він стосується конкретного проєкту. Якщо це спам або несуттєвий пост, поверни 'false'." }, { role: "user", content: text }],
            temperature: 0.5
        }, {
            headers: { "Authorization": `Bearer ${openaiApiKey}` }
        });

        //console.log(response.data);

        return response.data.choices[0].message.content.trim();
    } catch (error) {
        console.error("❌ Помилка OpenAI:", error.response ? error.response.data : error.message);
        return "false";
    }
}

// 🗑 Видалення старих постів (старших за 2 тижні)
async function deleteOldPosts() {
    const twoWeeksAgo = admin.firestore.Timestamp.fromMillis(Date.now() - 14 * 24 * 60 * 60 * 1000);
    const snapshot = await db.collection("telegram_posts").where("createdAt", "<", twoWeeksAgo).get();

    for (const doc of snapshot.docs) {
        const data = doc.data();
        if (data.media?.url) {
            const fileName = data.media.url.split("/").pop();
            try {
                await bucket.file(`telegram_images/${fileName}`).delete();
                console.log(`🗑 Видалено фото: ${fileName}`);
            } catch (err) {
                console.warn(`⚠️ Не вдалося видалити фото ${fileName}:`, err.message);
            }
        }
        await db.collection("telegram_posts").doc(doc.id).delete();
        console.log(`🗑 Видалено старий запис ID ${doc.id}`);
    }
}

// Основний код
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
                if (message.media?.photo) {
                    const filePath = `./downloads/${message.id}.jpg`;
                    const result = await client.downloadMedia(message.media, { file: filePath });
                    fs.writeFileSync(filePath, result);
                    mediaUrl = await uploadToFirebase(filePath, `${message.id}.jpg`);
                    fs.unlinkSync(filePath);
                }

                const postText = message.message || "";
                const projectName = await filterPostWithAI(postText);

                if (projectName.toLowerCase() === "false") {
                    console.log("❌ Пост відфільтровано, не зберігаємо.");
                    return;
                }

                console.log(`✅ Пост пройшов перевірку. Проєкт: ${projectName}`);

                // Перевіряємо, чи такий проєкт вже є в БД
                
                // const existingProject = await db.collection("telegram_posts")
                //     .where("projectname", "==", projectName)
                //     .limit(1)
                //     .get();

                // if (!existingProject.empty) {
                //     console.log(`⚠️ Проєкт ${projectName} вже є в базі. Не зберігаємо дубль.`);
                //     return;
                // }

                // Генеруємо ID
                const counterRef = db.collection("counters").doc("posts");
                const counterDoc = await counterRef.get();
                let lastIndexId = counterDoc.exists ? counterDoc.data().lastIndexId + 1 : 1;
                await counterRef.set({ lastIndexId });

                await db.collection("telegram_posts").doc(lastIndexId.toString()).set({
                    indexId: lastIndexId,
                    chatId: formattedChannelId.toString(),
                    postId: message.id,
                    text: postText,
                    media: mediaUrl ? { type: "photo", url: mediaUrl } : null,
                    projectname: projectName,
                    createdAt: admin.firestore.FieldValue.serverTimestamp(),
                });

                await client.sendMessage(forwardChatId, {
                    message: postText,
                    entities: message.entities,
                    ...(mediaUrl && { media: message.media })
                });

                console.log("✅ Повідомлення збережено в Firebase!");
            }
        }
    });

    // Запускаємо видалення старих записів раз в день
    setInterval(deleteOldPosts, 24 * 60 * 60 * 1000);
})();
