const { TelegramClient } = require("telegram");
const { StringSession } = require("telegram/sessions");
const fs = require("fs");
const path = require('path');

const downloadDir = path.join(__dirname, 'downloads');
if (!fs.existsSync(downloadDir)) {
    fs.mkdirSync(downloadDir, { recursive: true });
    console.log('📂 Папку downloads створено');
}
const prompt = require("prompt-sync")();
const { savePost, savePhotoToDB } = require("./mongo");


const config = JSON.parse(fs.readFileSync("config.json", "utf8"));
const apiId = config.api_id;
const apiHash = config.api_hash;
const forwardChatId = BigInt(config.forward_chat_id);
const channelIds = new Set(config.channels.map(id => BigInt(id)));

let session = new StringSession("");
if (fs.existsSync("session.json")) {
    session = new StringSession(fs.readFileSync("session.json", "utf8"));
}

const client = new TelegramClient(session, apiId, apiHash, {
    connectionRetries: 5,
});

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

            if (!message || !message.peerId || !message.peerId.channelId) {
                console.log("⚠️ Невідоме повідомлення або відсутній channelId");
                return;
            }

            const rawChannelId = message.peerId.channelId; // Отриманий ID без -100
            const formattedChannelId = BigInt(`-100${rawChannelId}`); // Додаємо -100

            if (channelIds.has(formattedChannelId)) {
                console.log(`📩 Нове повідомлення з каналу ${formattedChannelId}`);

                try {
                    const messageId = message.id;
                    console.log("📩 Отриманий messageId:", messageId);
                    console.log("📡 Від кого пересилаємо (formattedChannelId):", formattedChannelId);
                    console.log("📤 Куди пересилаємо (forwardChatId):", forwardChatId);

                    // Перевіримо, чи є значення перед відправкою
                    if (!messageId || !forwardChatId) {
                        console.log("⚠️ Немає messageId або forwardChatId");
                        return;
                    }

                    // Отримуємо entity каналу перед відправкою
                    const fromPeer = await client.getInputEntity(formattedChannelId);
                    console.log("🔄 Отриманий fromPeer:", fromPeer);

                    if (fromPeer.className !== 'InputPeerChannel') {
                        console.log("⚠️ fromPeer не є InputPeerChannel");
                        return;
                    }

                    let mediaId = null;
                    if (message.media && message.media.photo) {
                        console.log("📸 Знайдено фото!");
                        console.log('📸 Вміст message.media:', message.media);

                        const filePath = `./downloads/${messageId}.jpg`;

                        console.log(filePath)

                        // Завантажуємо фото локально
                        //await client.downloadMedia(message.media, { file: filePath });
                        const result = await client.downloadMedia(message.media, { file: filePath });
                        console.log('✅ Завантаження завершено:', result);
                        if (result && result.length > 0) {
                            fs.writeFileSync(filePath, result);
                            console.log('✅ Файл збережено:', filePath);
                        } else {
                            console.log('❌ Отриманий буфер порожній!');
                        }

                        // Завантажуємо в MongoDB
                        mediaId = await savePhotoToDB(filePath, `${messageId}.jpg`);
                    }

                    await savePost({
                        id: message.id,
                        chatId: formattedChannelId.toString(),
                        text: message.message || "",
                        media: mediaId ? { type: "photo", file_id: mediaId } : null,
                        timestamp: new Date(),
                    });

                    if (mediaId) {
                        await client.sendMessage(forwardChatId, {
                            message: message.message,
                            media: message.media,
                            entities: message.entities,
                        });
                    } else {
                        await client.sendMessage(forwardChatId, {
                            message: message.message,
                            entities: message.entities,
                        });
                    }

                    console.log("✅ Повідомлення відправлено і збережено в базі!");

                    console.log("🔄 Надсилаємо повідомлення...");
                    console.log("✅ Повідомлення відправлено!");

                } catch (err) {
                    console.log("❌ Помилка відправки:", err);
                    console.log("🔍 Подробиці помилки:", JSON.stringify(err, null, 2));
                }
            }
        }
    });
})();
