"use strict";

const db = require("../../db");
const mysql = require("mysql2/promise");
const { execSync, execFileSync } = require("child_process");
const { idSeguro, resolverArquivoUpdate } = require("../utils/caminhoSeguro");
const path = require("path");
const fs = require("fs");
const axios = require("axios");
const { criarBackupInterno } = require("./systemBackupController.internal");

const PROJECT_ROOT = "/var/www/hotspot";

// ---------------------------------------------------------------------------
// Log helper - persiste cada etapa em update_apply_logs para debugging posterior.
// Usa pool compartilhado; falhas de log sao silenciadas pra nao abortar o apply.
// ---------------------------------------------------------------------------
async function logApply(updateId, step, status, message) {
  const prefix = `[apply ${updateId}] ${step} [${status}]`;
  if (status === "erro") console.error(prefix, message || "");
  else console.log(prefix, message || "");
  try {
    await db.execute(
      "INSERT INTO update_apply_logs (update_id, step, status, message) VALUES (?, ?, ?, ?)",
      [updateId || "unknown", step, status, message ? String(message).slice(0, 4000) : null]
    );
  } catch (logErr) {
    console.error("logApply DB falhou:", logErr.message);
  }
}

// ---------------------------------------------------------------------------
// Runner de migrations SQL - conexao dedicada com multipleStatements
// habilitado para suportar arquivos com multiplos statements.
// DDL em MySQL faz auto-commit, entao rodamos sequencialmente sem transacao
// e reportamos o primeiro erro com contexto.
// ---------------------------------------------------------------------------
async function aplicarMigrations(migrations) {
  if (!migrations || migrations.length === 0) return { aplicadas: 0 };

  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT || 3306,
    multipleStatements: true,
  });

  let aplicadas = 0;
  try {
    for (let i = 0; i < migrations.length; i++) {
      const m = migrations[i];
      const sqlRaw = typeof m === "string" ? m : m.sql;
      if (!sqlRaw || !sqlRaw.trim()) continue;
      try {
        await conn.query(sqlRaw);
        aplicadas++;
      } catch (sqlErr) {
        const preview = sqlRaw.slice(0, 200).replace(/\s+/g, " ");
        throw new Error(
          `Migration ${i + 1}/${migrations.length} falhou: ${sqlErr.message} | SQL: ${preview}`
        );
      }
    }
  } finally {
    try {
      await conn.end();
    } catch {}
  }
  return { aplicadas };
}

// ---------------------------------------------------------------------------
// POST /api/system/updates/verificar
// Body: { email }
// ---------------------------------------------------------------------------
async function verificarAtualizacoes(req, res) {
  try {
    const { email } = req.body || {};

    const updateServerUrl = process.env.UPDATE_SERVER_URL;
    if (!updateServerUrl) {
      return res
        .status(500)
        .json({ message: "UPDATE_SERVER_URL não configurado" });
    }

    // Get last applied update id
    const [[lastRow]] = await db.query(
      "SELECT id FROM applied_updates ORDER BY id DESC LIMIT 1"
    );
    const last_update_id = lastRow ? lastRow.id : null;

    // Call master server
    const response = await axios.post(
      `${updateServerUrl}/api/updates/check`,
      { email, last_update_id },
      { timeout: 30000 }
    );

    res.json(response.data);
  } catch (err) {
    console.error("Erro ao verificar atualizações:", err);

    if (err.response) {
      return res
        .status(err.response.status)
        .json(
          err.response.data || { message: "Erro ao verificar atualizações" }
        );
    }

    res
      .status(500)
      .json({ message: "Erro ao verificar atualizações: " + err.message });
  }
}

// ---------------------------------------------------------------------------
// POST /api/system/updates/aplicar
// Body: { email, update_id }
// ---------------------------------------------------------------------------
async function aplicarAtualizacao(req, res) {
  const { email, update_id } = req.body || {};
  try {
    if (!update_id || !idSeguro(update_id)) {
      return res.status(400).json({ message: "update_id inválido" });
    }

    const updateServerUrl = process.env.UPDATE_SERVER_URL;
    if (!updateServerUrl) {
      return res
        .status(500)
        .json({ message: "UPDATE_SERVER_URL não configurado" });
    }

    await logApply(update_id, "inicio", "info", `Iniciando apply do update ${update_id}`);

    // --- Pre-update backup ---
    await logApply(update_id, "backup", "info", "Criando backup pre-update");
    try {
      await criarBackupInterno(update_id, "pre_update");
      await logApply(update_id, "backup", "ok", "Backup pre-update criado");
    } catch (bkpErr) {
      await logApply(update_id, "backup", "erro", bkpErr.message);
      throw new Error("Falha no backup pre-update: " + bkpErr.message);
    }

    // --- Download package from master ---
    await logApply(update_id, "download", "info", `Baixando pacote de ${updateServerUrl}`);
    const downloadResponse = await axios.post(
      `${updateServerUrl}/api/updates/download/${update_id}`,
      { email },
      { timeout: 60000 }
    );

    const packageData = downloadResponse.data;
    const files = packageData.files || [];
    const migrations = packageData.migrations || [];
    await logApply(
      update_id,
      "download",
      "ok",
      `Pacote recebido: ${files.length} arquivo(s), ${migrations.length} migration(s)`
    );

    // --- Apply files ---
    await logApply(update_id, "arquivos", "info", `Gravando ${files.length} arquivo(s) no disco`);
    let frontendChanged = false;
    let backendPackageChanged = false;
    let frontendPackageChanged = false;
    let freeradiusChanged = false;
    let filesOk = 0;
    const EXTERNAL_PREFIX = "external:";

    for (const file of files) {
      // Paths com prefixo "external:" sao gravados no caminho absoluto original
      // (ex: /etc/freeradius/3.0/dictionary). Demais paths vao relativos ao PROJECT_ROOT.
      // Destino validado: dentro do projeto ou em /etc/freeradius/3.0/ (nunca .env, certificados, "..").
      const { filePath, isExternal } = resolverArquivoUpdate(PROJECT_ROOT, file.path);

      try {
        if (file.action === "delete") {
          if (fs.existsSync(filePath)) {
            fs.rmSync(filePath, { force: true });
          }
        } else {
          const dir = path.dirname(filePath);
          if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
          }

          const encoding = file.encoding || "utf8";
          if (encoding === "base64") {
            fs.writeFileSync(filePath, Buffer.from(file.content, "base64"));
          } else {
            fs.writeFileSync(filePath, file.content, "utf8");
          }

          // Arquivos de FreeRADIUS precisam pertencer ao user 'freerad' com modo 640,
          // senao o daemon nao consegue ler e falha no restart.
          if (isExternal && filePath.startsWith("/etc/freeradius/")) {
            try {
              execFileSync("chown", ["freerad:freerad", filePath], { stdio: "pipe" });
              execFileSync("chmod", ["640", filePath], { stdio: "pipe" });
            } catch (chownErr) {
              await logApply(update_id, "arquivos", "aviso",
                `chown/chmod falhou em ${filePath}: ${chownErr.message}`);
            }
            freeradiusChanged = true;
          }
        }
        filesOk++;
      } catch (fsErr) {
        await logApply(update_id, "arquivos", "erro", `${file.path}: ${fsErr.message}`);
        throw new Error(`Erro escrevendo ${file.path}: ${fsErr.message}`);
      }

      if (file.path.startsWith("frontend/")) {
        frontendChanged = true;
        if (file.path === "frontend/package.json") frontendPackageChanged = true;
      }
      if (file.path === "backend/package.json") backendPackageChanged = true;
    }
    await logApply(update_id, "arquivos", "ok", `${filesOk}/${files.length} arquivos aplicados`);

    // --- Restart FreeRADIUS se algum arquivo em /etc/freeradius/ foi tocado ---
    if (freeradiusChanged) {
      await logApply(update_id, "freeradius", "info", "Configs do FreeRADIUS alteradas, reiniciando daemon");
      try {
        execSync("systemctl restart freeradius", { stdio: "pipe" });
        await logApply(update_id, "freeradius", "ok", "FreeRADIUS reiniciado com sucesso");
      } catch (radErr) {
        await logApply(update_id, "freeradius", "erro",
          `systemctl restart freeradius falhou: ${radErr.message}`);
        throw new Error("Falha ao reiniciar FreeRADIUS: " + radErr.message);
      }
    }

    // --- Run SQL migrations ---
    let migResult = { aplicadas: 0 };
    if (migrations.length > 0) {
      await logApply(update_id, "migrations", "info", `Rodando ${migrations.length} migration(s)`);
      try {
        migResult = await aplicarMigrations(migrations);
        await logApply(update_id, "migrations", "ok", `${migResult.aplicadas} migration(s) aplicada(s)`);
      } catch (migErr) {
        await logApply(update_id, "migrations", "erro", migErr.message);
        throw migErr;
      }
    } else {
      await logApply(update_id, "migrations", "info", "Nenhuma migration no pacote");
    }

    // --- npm install if package.json changed ---
    if (backendPackageChanged) {
      await logApply(update_id, "npm_backend", "info", "backend/package.json mudou, rodando npm install");
      try {
        execSync("npm install --production", {
          cwd: path.join(PROJECT_ROOT, "backend"),
          stdio: "pipe",
        });
        await logApply(update_id, "npm_backend", "ok", "npm install backend concluido");
      } catch (npmErr) {
        await logApply(update_id, "npm_backend", "erro", npmErr.message);
        throw new Error("npm install backend falhou: " + npmErr.message);
      }
    }

    if (frontendPackageChanged) {
      await logApply(update_id, "npm_frontend", "info", "frontend/package.json mudou, rodando npm install");
      try {
        execSync("npm install", {
          cwd: path.join(PROJECT_ROOT, "frontend"),
          stdio: "pipe",
        });
        await logApply(update_id, "npm_frontend", "ok", "npm install frontend concluido");
      } catch (npmErr) {
        await logApply(update_id, "npm_frontend", "erro", npmErr.message);
        throw new Error("npm install frontend falhou: " + npmErr.message);
      }
    }

    // --- Rebuild frontend if any frontend/ files changed ---
    if (frontendChanged) {
      await logApply(update_id, "build", "info", "Rebuildando frontend (npm run build)");
      try {
        execSync("npm run build", {
          cwd: path.join(PROJECT_ROOT, "frontend"),
          stdio: "pipe",
        });
        await logApply(update_id, "build", "ok", "Build concluido");
      } catch (buildErr) {
        await logApply(update_id, "build", "erro", buildErr.message);
        throw new Error("npm run build falhou: " + buildErr.message);
      }
    }

    // --- Register applied update ---
    await db.execute(
      `INSERT INTO applied_updates (id, descricao) VALUES (?, ?) ON DUPLICATE KEY UPDATE descricao = VALUES(descricao)`,
      [update_id, packageData.descricao || packageData.description || ""]
    );
    await logApply(update_id, "registro", "ok", "Update registrado em applied_updates");
    await logApply(update_id, "concluido", "ok", "Atualizacao aplicada com sucesso, reiniciando PM2 em 1.5s");

    // Respond before restarting
    res.json({
      success: true,
      applied: true,
      message: "Atualização aplicada com sucesso. O servidor será reiniciado em instantes.",
      update_id,
      files_aplicados: filesOk,
      migrations_aplicadas: migResult.aplicadas,
    });

    // Restart PM2 after response is sent
    setTimeout(() => {
      try {
        execSync("pm2 restart all", { stdio: "pipe" });
      } catch (restartErr) {
        console.error("Erro ao reiniciar PM2:", restartErr);
      }
    }, 1500);
  } catch (err) {
    console.error("Erro ao aplicar atualização:", err);
    await logApply(update_id || "unknown", "falha", "erro", err.message);
    res
      .status(500)
      .json({ success: false, message: "Erro ao aplicar atualização: " + err.message });
  }
}

// ---------------------------------------------------------------------------
// GET /api/system-update/logs
// Query: ?update_id=X  (opcional - filtra por update_id)
// Retorna ate 500 linhas ordenadas por id ASC
// ---------------------------------------------------------------------------
async function listarLogs(req, res) {
  try {
    const { update_id } = req.query;
    let rows;
    if (update_id) {
      [rows] = await db.execute(
        "SELECT id, update_id, step, status, message, criado_em FROM update_apply_logs WHERE update_id = ? ORDER BY id ASC LIMIT 500",
        [update_id]
      );
    } else {
      [rows] = await db.execute(
        "SELECT id, update_id, step, status, message, criado_em FROM update_apply_logs ORDER BY id DESC LIMIT 500"
      );
    }
    res.json({ logs: rows });
  } catch (err) {
    console.error("listarLogs error:", err);
    res.status(500).json({ message: "Erro ao listar logs: " + err.message });
  }
}

module.exports = {
  verificarAtualizacoes,
  aplicarAtualizacao,
  listarLogs,
};
