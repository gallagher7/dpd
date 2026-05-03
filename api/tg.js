export const config = { runtime: "nodejs" };

function normDomain(raw) {
  if (!raw) return null;
  let d = raw.trim().toLowerCase()
    .replace(/^https?:\/\//, "").replace(/\/.*$/, "")
    .replace(/:\d+$/, "").replace(/^www\./, "");
  return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(d) ? d : null;
}

async function upstash(cmd) {
  const r = await fetch(
    `${process.env.UPSTASH_REDIS_REST_URL}/${cmd.map(encodeURIComponent).join("/")}`,
    { headers: { Authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}` } }
  );
  return (await r.json()).result;
}

async function send(chatId, text) {
  await fetch(`https://api.telegram.org/bot${process.env.TG_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();
  
  const msg = req.body?.message;
  const chatId = msg?.chat?.id;
  if (!chatId) return res.json({ ok: true });

  if (String(chatId) !== String(process.env.TG_ALLOWED_GROUP_ID)) {
    return res.json({ ok: true });
  }

  if (!msg.text) return res.json({ ok: true });

  const parts = msg.text.trim().split(/\s+/);
  let cmd = parts[0].toLowerCase().split('@')[0]; 
  const domain = normDomain(parts[1]);

  if (cmd === "/list") {
    const keys = await upstash(["keys", "lic:*"]);
    const arr = Array.isArray(keys) ? keys : [];
    if (!arr.length) {
      await send(chatId, "No domains registered.");
      return res.json({ ok: true });
    }
    const domains = arr.map(k => k.replace("lic:", "")).sort();
    const statuses = await Promise.all(domains.map(d => upstash(["get", `site:${d}`])));
    const lines = domains.map((d, i) => `${statuses[i] === "off" ? "🔴" : "🟢"} ${d}`);
    await send(chatId, `<b>Domain List (${domains.length}):</b>\n\n${lines.join("\n")}`);
    return res.json({ ok: true });
  }

  if (!domain) {
    const usage = {
      "/add": "/add domain.com",
      "/del": "/del domain.com",
      "/start": "/start domain.com",
      "/stop": "/stop domain.com",
      "/status": "/status domain.com",
    };
    
    if (usage[cmd]) {
      await send(chatId, `Usage: ${usage[cmd]}`);
    } else if (cmd.startsWith("/")) {
       await send(chatId, "Commands:\n/add <domain>\n/del <domain>\n/start <domain>\n/stop <domain>\n/status <domain>\n/list");
    }
    return res.json({ ok: true });
  }

  if (cmd === "/add") {
    await upstash(["set", `lic:${domain}`, "1"]);
    await upstash(["set", `site:${domain}`, "on"]);
    await send(chatId, `✅ <b>${domain}</b> added and active.`);
  } else if (cmd === "/del" || cmd === "/delete") {
    await upstash(["del", `lic:${domain}`]);
    await upstash(["del", `site:${domain}`]);
    await send(chatId, `🗑️ <b>${domain}</b> removed.`);
  } else if (cmd === "/start") {
    const exists = await upstash(["get", `lic:${domain}`]);
    if (exists !== "1") {
      await send(chatId, `Not registered. Add it first: /add ${domain}`);
    } else {
      await upstash(["set", `site:${domain}`, "on"]);
      await send(chatId, `🟢 <b>${domain}</b> is now online.`);
    }
  } else if (cmd === "/stop") {
    const exists = await upstash(["get", `lic:${domain}`]);
    if (exists !== "1") {
      await send(chatId, `Not registered. Add it first: /add ${domain}`);
    } else {
      await upstash(["set", `site:${domain}`, "off"]);
      await send(chatId, `🔴 <b>${domain}</b> is now offline.`);
    }
  } else if (cmd === "/status") {
    const [lic, site] = await Promise.all([
      upstash(["get", `lic:${domain}`]),
      upstash(["get", `site:${domain}`]),
    ]);
    const icon = lic !== "1" ? "❌" : site === "off" ? "🔴" : "🟢";
    await send(chatId, 
      `${icon} <b>${domain}</b>\n` +
      `Registered: ${lic === "1" ? "Yes" : "No"}\n` +
      `Status: ${site === "off" ? "Offline" : "Online"}`
    );
  }

  return res.json({ ok: true });
}
