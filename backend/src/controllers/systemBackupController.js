"use strict";

const db = require("../../db");
const { execSync, execFileSync } = require("child_process");
const { idSeguro } = require("../utils/caminhoSeguro");
const path = require("path");
const fs = require("fs");
const jwt = require("jsonwebtoken");
const { criarBackupInterno } = require("./systemBackupController.internal");
const { ehDonoPlataforma } = require("../utils/donoPlataforma");

const PROJECT_ROOT = "/var/www/hotspot";
const BACKUPS_DIR = path.join(PROJECT_ROOT, "backups");

// Os caminhos vem do banco: so valem se estiverem dentro da pasta de backups.
const dentro = (p) => !!p && path.resolve(p).startsWith(path.resolve(BACKUPS_DIR) + path.sep);

const PROPOSITO_DOWNLOAD = "backup-download";
const TIPOS_DOWNLOAD = { db: "db_dump_path", files: "files_zip_path" };

// ---------------------------------------------------------------------------
// GET /api/system/backups
// ---------------------------------------------------------------------------
async function listarBackups(req, res) {
  try {
    const [rows] = await db.query(
      "SELECT * FROM system_backups ORDER BY criado_em DESC"
    );

    const backups = rows.map((row) => {
      const dbExists = row.db_dump_path
        ? fs.existsSync(row.db_dump_path)
        : false;
      const filesExists = row.files_zip_path
        ? fs.existsSync(row.files_zip_path)
        : false;

      return {
        ...row,
        db_exists: dbExists,
        files_exists: filesExists,
      };
    });

    res.json(backups);
  } catch (err) {
    console.error("Erro ao listar backups:", err);
    res.status(500).json({ message: "Erro ao listar backups" });
  }
}

// ---------------------------------------------------------------------------
// POST /api/system/backups
// Body: { update_id?, tipo? }
// ---------------------------------------------------------------------------
async function criarBackup(req, res) {
  try {
    const { update_id, tipo } = req.body || {};
    if (update_id && !idSeguro(update_id)) {
      return res.status(400).json({ message: "update_id inválido" });
    }

    const result = await criarBackupInterno(update_id || null, tipo || "manual");

    res.status(201).json({
      message: "Backup criado com sucesso",
      backup_id: result.backupId,
      backup_dir: result.backupDir,
      db_dump_path: result.dbDumpPath,
      files_zip_path: result.filesZipPath,
    });
  } catch (err) {
    console.error("Erro ao criar backup:", err);
    res.status(500).json({ message: "Erro ao criar backup" });
  }
}

// ---------------------------------------------------------------------------
// POST /api/system/backups/:id/restaurar
// ---------------------------------------------------------------------------
async function restaurarBackup(req, res) {
  try {
    const { id } = req.params;

    const [[backup]] = await db.execute(
      "SELECT * FROM system_backups WHERE id = ?",
      [id]
    );

    if (!backup) {
      return res.status(404).json({ message: "Backup não encontrado" });
    }

    if (!dentro(backup.db_dump_path) || !dentro(backup.files_zip_path)) {
      return res.status(400).json({ message: "Caminho de backup inválido" });
    }

    // Verify files exist
    const dbExists = backup.db_dump_path && fs.existsSync(backup.db_dump_path);
    const filesExists =
      backup.files_zip_path && fs.existsSync(backup.files_zip_path);

    if (!dbExists) {
      return res
        .status(400)
        .json({ message: "Arquivo de dump do banco não encontrado em disco" });
    }
    if (!filesExists) {
      return res
        .status(400)
        .json({ message: "Arquivo zip de arquivos não encontrado em disco" });
    }

    // --- Restore MySQL ---
    const host = process.env.DB_HOST || "127.0.0.1";
    const port = process.env.DB_PORT || "3306";
    const user = process.env.DB_USER;
    const password = process.env.DB_PASSWORD;
    const dbName = process.env.DB_NAME;

    const entrada = fs.openSync(backup.db_dump_path, "r");
    try {
      execFileSync("mysql", ["-h", host, "-P", String(port), "-u", String(user), String(dbName)], {
        stdio: [entrada, "pipe", "pipe"],
        env: { ...process.env, MYSQL_PWD: password || "" },
      });
    } finally {
      fs.closeSync(entrada);
    }

    // --- Restore files ---
    if (backup.files_zip_path.endsWith(".tar.gz")) {
      execFileSync("tar", ["xzf", backup.files_zip_path, "-C", PROJECT_ROOT], { stdio: "pipe" });
    } else {
      execFileSync("unzip", ["-o", backup.files_zip_path, "-d", PROJECT_ROOT], { stdio: "pipe" });
    }

    // --- Rebuild frontend ---
    execSync("npm run build", {
      cwd: path.join(PROJECT_ROOT, "frontend"),
      stdio: "pipe",
    });

    // Respond before restarting
    res.json({
      message:
        "Backup restaurado com sucesso. O servidor será reiniciado em instantes.",
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
    console.error("Erro ao restaurar backup:", err);
    res.status(500).json({ message: "Erro ao restaurar backup" });
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/system/backups/:id
// ---------------------------------------------------------------------------
async function deletarBackup(req, res) {
  try {
    const { id } = req.params;

    const [[backup]] = await db.execute(
      "SELECT * FROM system_backups WHERE id = ?",
      [id]
    );

    if (!backup) {
      return res.status(404).json({ message: "Backup não encontrado" });
    }

    // Remove directory from disk (derive from db_dump_path)
    const backupDir = backup.db_dump_path ? path.dirname(backup.db_dump_path) : null;
    if (backupDir && path.resolve(backupDir).startsWith(path.resolve(BACKUPS_DIR) + path.sep) && fs.existsSync(backupDir)) {
      fs.rmSync(backupDir, { recursive: true, force: true });
    }

    // Delete from DB
    await db.execute("DELETE FROM system_backups WHERE id = ?", [id]);

    res.json({ message: "Backup deletado com sucesso" });
  } catch (err) {
    console.error("Erro ao deletar backup:", err);
    res.status(500).json({ message: "Erro ao deletar backup" });
  }
}

// ---------------------------------------------------------------------------
// POST /api/system-backup/:id/download-token   Body: { tipo: 'db' | 'files' }
// Devolve um link de uso curto (60 s): o download em si e' feito pelo navegador (streaming),
// sem carregar centenas de MB em memoria como um fetch + blob faria.
// ---------------------------------------------------------------------------
async function gerarTokenDownload(req, res) {
  try {
    const id = Number(req.params.id);
    const tipo = req.body && req.body.tipo;
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: "Backup inválido" });
    if (!Object.prototype.hasOwnProperty.call(TIPOS_DOWNLOAD, tipo)) {
      return res.status(400).json({ message: "Tipo inválido (use db ou files)" });
    }

    const [[backup]] = await db.execute("SELECT * FROM system_backups WHERE id = ?", [id]);
    if (!backup) return res.status(404).json({ message: "Backup não encontrado" });

    const caminho = backup[TIPOS_DOWNLOAD[tipo]];
    if (!dentro(caminho)) return res.status(400).json({ message: "Caminho de backup inválido" });
    if (!fs.existsSync(caminho)) return res.status(404).json({ message: "Arquivo não encontrado em disco" });

    const t = jwt.sign(
      { proposito: PROPOSITO_DOWNLOAD, backup_id: id, tipo, admin_id: req.user.id },
      process.env.JWT_SECRET,
      { expiresIn: 60 }
    );
    console.log(`[backup] download liberado: backup=${id} tipo=${tipo} admin=${req.user.id}`);
    res.json({ url: `/api/system-backup/download?t=${encodeURIComponent(t)}` });
  } catch (err) {
    console.error("Erro ao liberar download de backup:", err);
    res.status(500).json({ message: "Erro ao liberar download" });
  }
}

// ---------------------------------------------------------------------------
// GET /api/system-backup/download?t=<token>   (sem header de auth: o token e' a prova)
// ---------------------------------------------------------------------------
async function baixarBackup(req, res) {
  try {
    let dados;
    try {
      dados = jwt.verify(String(req.query.t || ""), process.env.JWT_SECRET, { algorithms: ["HS256"] });
    } catch {
      return res.status(401).json({ message: "Link de download inválido ou expirado" });
    }
    if (!dados || dados.proposito !== PROPOSITO_DOWNLOAD || !Object.prototype.hasOwnProperty.call(TIPOS_DOWNLOAD, dados.tipo)) {
      return res.status(401).json({ message: "Link de download inválido ou expirado" });
    }

    // O dono e' conferido de novo no banco: quem perdeu o perfil nao usa um link ainda valido.
    if (!(await ehDonoPlataforma(dados.admin_id, "super_admin"))) {
      return res.status(403).json({ message: "Acesso negado" });
    }

    const [[backup]] = await db.execute("SELECT * FROM system_backups WHERE id = ?", [Number(dados.backup_id)]);
    if (!backup) return res.status(404).json({ message: "Backup não encontrado" });

    const caminho = backup[TIPOS_DOWNLOAD[dados.tipo]];
    if (!dentro(caminho)) return res.status(400).json({ message: "Caminho de backup inválido" });
    if (!fs.existsSync(caminho)) return res.status(404).json({ message: "Arquivo não encontrado em disco" });

    // Nome montado aqui, nunca vindo do cliente.
    const ext = dados.tipo === "db" ? ".sql" : caminho.endsWith(".tar.gz") ? ".tar.gz" : ".zip";
    const nome = `backup-${backup.id}-${dados.tipo === "db" ? "banco" : "arquivos"}${ext}`;

    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.download(caminho, nome, (err) => {
      if (err && !res.headersSent) res.status(500).json({ message: "Erro ao baixar backup" });
    });
  } catch (err) {
    console.error("Erro ao baixar backup:", err);
    if (!res.headersSent) res.status(500).json({ message: "Erro ao baixar backup" });
  }
}

module.exports = {
  gerarTokenDownload,
  baixarBackup,
  listarBackups,
  criarBackup,
  restaurarBackup,
  deletarBackup,
};
