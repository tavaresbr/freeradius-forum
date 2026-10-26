"use strict";

const db = require("../../db");
const { execFileSync } = require("child_process");
const { idSeguro } = require("../utils/caminhoSeguro");
const path = require("path");
const fs = require("fs");

const PROJECT_ROOT = "/var/www/hotspot";
const BACKUPS_DIR = path.join(PROJECT_ROOT, "backups");

/**
 * Internal helper — creates a backup without req/res.
 * Returns { backupId, backupDir, dbDumpPath, filesZipPath }
 */
async function criarBackupInterno(updateId, tipo) {
  if (updateId && !idSeguro(updateId)) throw new Error("update_id inválido");

  // Ensure backups directory exists
  if (!fs.existsSync(BACKUPS_DIR)) {
    fs.mkdirSync(BACKUPS_DIR, { recursive: true });
  }

  // Build backup directory name
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const timestamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const dirName = updateId ? String(updateId) : `manual-${timestamp}`;
  const backupDir = path.join(BACKUPS_DIR, dirName);

  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  // Paths
  const dbDumpPath = path.join(backupDir, "database.sql");
  const filesZipPath = path.join(backupDir, "files.tar.gz");

  // --- MySQL dump ---
  const host = process.env.DB_HOST || "127.0.0.1";
  const port = process.env.DB_PORT || "3306";
  const user = process.env.DB_USER;
  const password = process.env.DB_PASSWORD;
  const dbName = process.env.DB_NAME;

  // senha por variavel de ambiente: nunca na linha de comando (aparece em ps e nas mensagens de erro)
  try {
    execFileSync("mysqldump", ["-h", host, "-P", String(port), "-u", String(user), `--result-file=${dbDumpPath}`, String(dbName)], {
      stdio: "pipe",
      env: { ...process.env, MYSQL_PWD: password || "" },
    });
  } catch {
    throw new Error("Falha ao exportar o banco (mysqldump)");
  }

  // --- Zip project files ---
  // Files/dirs to include (relative to PROJECT_ROOT), excluding node_modules
  const includeTargets = [
    "backend/src",
    "backend/server.js",
    "backend/package.json",
    "backend/routes",
    "frontend/src",
    "frontend/package.json",
    "frontend/vite.config.js",
  ]
    .filter((t) => fs.existsSync(path.join(PROJECT_ROOT, t)))
    ;

  execFileSync("tar", ["czf", filesZipPath, "--exclude=*/node_modules/*", ...includeTargets], { stdio: "pipe", cwd: PROJECT_ROOT });

  // --- Record in DB ---
  const tipoFinal = tipo || (updateId ? "pre_update" : "manual");
  const [result] = await db.execute(
    `INSERT INTO system_backups (update_id, tipo, db_dump_path, files_zip_path) VALUES (?, ?, ?, ?)`,
    [updateId || null, tipoFinal, dbDumpPath, filesZipPath]
  );

  return {
    backupId: result.insertId,
    backupDir,
    dbDumpPath,
    filesZipPath,
  };
}

module.exports = { criarBackupInterno };
