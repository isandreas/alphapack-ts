# Production Redis Operations & Persistence Guide

This document explains how to run `redis-server` in production on a self-hosted Linux VPS (e.g., Ubuntu/Debian with 768 MB – 1 GB RAM), where its data directory should be located, and how data persists across VPS restarts.

---

## 1. Service Mode (`systemctl`) vs. Detached Mode

**Recommendation:** Always run `redis-server` as a **`systemd` service (`systemctl`)** in production rather than spawning a raw process in detached mode.

### Why `systemd` (`systemctl`) is preferred in production
1. **Automatic startup on VPS boot:** `sudo systemctl enable redis-server` guarantees Redis starts before PM2 brings up `alphapack-bot`.
2. **Automatic crash recovery:** `systemd` monitors the daemon and restarts `redis-server` automatically if it ever exits unexpectedly.
3. **Graceful shutdown snapshot:** On a system reboot (`sudo reboot`), `systemd` sends `SIGTERM` to Redis and waits for it to write a final `dump.rdb` snapshot to disk before the OS powers off.
4. **Fixed configuration & working directory:** Reads `/etc/redis/redis.conf` consistently regardless of which directory your shell is in.

### Production Setup Commands (Ubuntu / Debian)
```bash
sudo apt update && sudo apt install -y redis-server
sudo systemctl enable redis-server
sudo systemctl start redis-server
sudo systemctl status redis-server
```

### Fallback: Manual Detached Mode (Without `systemd`)
If you ever need to run `redis-server` in detached mode outside `systemd` (e.g., in a minimal environment without `systemd`), **always pass `--daemonize yes` and an explicit `--dir`** so `dump.rdb` is written to a known path:
```bash
redis-server --daemonize yes --dir /var/lib/redis --dbfilename dump.rdb
```

---

## 2. Best Working Directory (`dir`) for `redis-server`

**Never run bare `redis-server` inside the project repository without a config file.**
When `redis-server` is started without a config file, it defaults to `dir ./` (the current working directory of your terminal when you launched it) and writes `dump.rdb` there.

### Recommended Paths by Environment

| Environment | How to Start | Data Directory (`dir`) | Config File |
|---|---|---|---|
| **Production (Linux VPS)** | `sudo systemctl start redis-server` | `/var/lib/redis` (`redis:redis`, `0750`) | `/etc/redis/redis.conf` |
| **Local Dev (macOS Homebrew)** | `brew services start redis` | `/opt/homebrew/var/db/redis` (Apple Silicon) or `/usr/local/var/db/redis` (Intel) | `/opt/homebrew/etc/redis.conf` |

### Verifying the Active Data Directory
You can inspect where the currently running `redis-server` stores its snapshot file at any time:
```bash
redis-cli CONFIG GET dir
redis-cli CONFIG GET dbfilename
```
Expected production output:
```text
1) "dir"
2) "/var/lib/redis"
1) "dbfilename"
2) "dump.rdb"
```

---

## 3. Data Persistence Across VPS Restarts

**Yes — your data persists across VPS restarts**, provided Redis is managed by `systemd` (or shut down cleanly) and writes to a persistent directory such as `/var/lib/redis`.

### How Persistence Works
1. **Periodic RDB Snapshots (Default):**
   By default (`save 3600 1 300 100 60 10000`), Redis snapshots the dataset in RAM to `/var/lib/redis/dump.rdb`:
   - Every **3600s (1 hour)** if at least **1 key** changed
   - Every **300s (5 minutes)** if at least **100 keys** changed
   - Every **60s (1 minute)** if at least **10,000 keys** changed
2. **Clean Reboot (`sudo reboot` / `sudo systemctl restart redis-server`):**
   - `systemd` sends `SIGTERM` to `redis-server`.
   - Redis immediately performs a **synchronous `SAVE`** to `/var/lib/redis/dump.rdb` before exiting — **zero data is lost**.
   - On boot, `redis-server` reads `/var/lib/redis/dump.rdb` back into memory before accepting client connections.
3. **Hard Power Loss / Kernel Panic (Unclean Shutdown):**
   - With **RDB only** (`appendonly no`), changes made since the last background snapshot (`BGSAVE`) could be lost in a sudden power cut.
   - **Optional Hardening (AOF + RDB):** To limit worst-case power-loss data loss to at most **1 second**, edit `/etc/redis/redis.conf`:
     ```conf
     appendonly yes
     appendfsync everysec
     ```
     Then restart the service:
     ```bash
     sudo systemctl restart redis-server
     ```

### Manual Backup Before Risky Deployments
Before major upgrades or server maintenance, trigger an immediate background snapshot and verify its timestamp:
```bash
redis-cli BGSAVE
redis-cli LASTSAVE
sudo cp /var/lib/redis/dump.rdb /var/lib/redis/dump.rdb.bak
```

