const { TelegramClient } = require("telegram");
const { StringSession } = require("telegram/sessions");
const fs = require("fs");
const prompt = require("prompt-sync")();

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

                    // Якщо є медіа, надсилаємо його як InputMediaPhoto
                    if (message.media && message.media.photo) {
                        const media = message.media.photo;
                        console.log("📸 Знайдено фото!");

                        await client.sendMessage(forwardChatId, {
                            message: message.message,
                            media: media,  // Передаємо медіа разом з текстом
                            entities: message.entities,
                        });
                    } else {
                        // Якщо медіа немає, просто надсилаємо текстове повідомлення
                        await client.sendMessage(forwardChatId, {
                            message: message.message,
                            entities: message.entities,
                        });
                    }

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
