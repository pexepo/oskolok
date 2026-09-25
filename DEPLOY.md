# 🚀 Руководство по деплою Oskolok на Oracle Cloud Always Free (Ubuntu Linux VPS)

В этом документе приведена пошаговая инструкция по развертыванию музыкального плеера **Oskolok**, бэкенда на **Node.js/Express**, базы данных **PostgreSQL**, веб-сервера **Nginx**, SSL-сертификата **Let's Encrypt** и менеджера процессов **PM2** на бесплатном облачном сервере **Oracle Cloud Always Free**.

---

## 🏗️ Целевая архитектура на VPS

```text
Интернет / Пользователи
              │
              ▼
   Nginx (:80 -> :443 HTTPS)
   ├── /        -> Статика React SPA (/var/www/oskolok/dist)
   │               (try_files $uri $uri/ /index.html)
   └── /api     -> Проксирование на Node.js Backend (127.0.0.1:5000)
                         │
                         ├── PM2: oskolok-api (:5000)
                         └── PostgreSQL (:5432)
```

---

## Шаг 1. Создание виртуального сервера (VPS) в Oracle Cloud

1. Войдите в консоль **Oracle Cloud Infrastructure (OCI)**.
2. Перейдите в раздел **Compute** → **Instances** → нажмите **Create Instance**.
3. Настройте конфигурацию инстанса:
   * **Image:** `Canonical Ubuntu 22.04` (или `Ubuntu 24.04 Minimal`).
   * **Shape:**
     * **Вариант 1 (Рекомендуется):** `VM.Standard.A1.Flex` (Ampere ARM, до 4 OCPU и 24 ГБ RAM бесплатно).
     * **Вариант 2:** `VM.Standard.E2.1.Micro` (AMD x86, 1 ГБ RAM).
   * **Networking:** выберите виртуальную сеть (VCN) по умолчанию и подсеть с публичным IP-адресом (**Assign a public IPv4 address**).
   * **SSH Keys:** скачайте сгенерированные приватный (`.key`) и публичный ключи на свой компьютер (или вставьте свой существующий SSH-ключ).
4. Нажмите **Create** и дождитесь статуса **Running**. Скопируйте **Public IP** вашего сервера (например, `129.150.x.x`).

---

## Шаг 2. Настройка фаервола в Oracle Cloud (Ingress Rules)

Oracle Cloud блокирует входящий трафик по умолчанию на уровне VCN. Необходимо разрешить порты `80` (HTTP) и `443` (HTTPS):

1. В деталях инстанса нажмите на имя подсети (**Subnet: ...**).
2. Нажмите на **Default Security List for ...**.
3. Нажмите **Add Ingress Rules**:
   * **Source CIDR:** `0.0.0.0/0`
   * **IP Protocol:** `TCP`
   * **Destination Port Range:** `80,443`
   * **Description:** `Allow HTTP and HTTPS`
4. Нажмите **Add Ingress Rules**.

---

## Шаг 3. Подключение к VPS по SSH

На вашем компьютере откройте терминал (PowerShell / WSL / Terminal) и выполните:

```bash
# Если ключ скачан из Oracle Console (замените путь и IP):
ssh -i /path/to/ssh-key.key ubuntu@YOUR_SERVER_IP
```

После успешного входа обновите пакеты системы и откройте порты в системном фаерволе `iptables`/`ufw`:

```bash
sudo apt update && sudo apt upgrade -y
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save
```

---

## Шаг 4. Установка Node.js, Git, Python и системных утилит

Для работы сервера Oskolok требуется **Node.js 20 LTS**, **Git**, **Python 3** и **ffmpeg** (для извлечения аудио):

```bash
# Установка curl, git, build-essential, ffmpeg, python3
sudo apt install -y curl git build-essential ffmpeg python3 python3-pip

# Установка Node.js 20 LTS через официальный репозиторий NodeSource
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Проверка версий
node -v   # Должно быть v20.x.x
npm -v    # Должно быть 10.x.x
```

---

## Шаг 5. Установка и настройка PostgreSQL

1. Установите PostgreSQL:
   ```bash
   sudo apt install -y postgresql postgresql-contrib
   sudo systemctl enable postgresql
   sudo systemctl start postgresql
   ```

2. Создайте базу данных и пользователя для Oskolok:
   ```bash
   sudo -u postgres psql
   ```

3. В интерактивной консоли PostgreSQL выполните команды (замените `your_secure_db_password` на надежный пароль):
   ```sql
   CREATE DATABASE oskolok;
   CREATE USER oskolok_user WITH ENCRYPTED PASSWORD 'your_secure_db_password';
   GRANT ALL PRIVILEGES ON DATABASE oskolok TO oskolok_user;
   ALTER DATABASE oskolok OWNER TO oskolok_user;
   \q
   ```

---

## Шаг 6. Загрузка проекта на сервер

Вы можете склонировать репозиторий с GitHub/GitLab либо скопировать файлы через `rsync`/`scp`:

```bash
# Переходим в директорию /var/www
sudo mkdir -p /var/www/oskolok
sudo chown -R ubuntu:ubuntu /var/www/oskolok
cd /var/www/oskolok

# Клонирование репозитория (или загрузка архива проекта)
git clone https://github.com/your-username/your-repo.git .
```

---

## Шаг 7. Установка зависимостей и настройка `.env`

1. Установите зависимости:
   ```bash
   npm install
   ```

2. Создайте рабочий файл `.env` из шаблона `.env.example`:
   ```bash
   cp .env.example .env
   nano .env
   ```

3. Заполните переменные боевыми значениями:
   ```env
   NODE_ENV=production
   PORT=5000

   # Строка подключения к PostgreSQL, созданному на Шаге 5
   DATABASE_URL="postgresql://oskolok_user:your_secure_db_password@localhost:5432/oskolok?schema=public"

   # Публичный адрес вашего домена (на который будет настроен Nginx на шаге 11)
   CORS_ORIGIN="https://your-domain.com"
   VITE_API_URL="/api"
   ```
   *Сохраните файл комбинацией `Ctrl + O`, подтвердите `Enter`, выйдите `Ctrl + X`.*

---

## Шаг 8. Миграция базы данных Prisma

Примените схему PostgreSQL к вашей базе данных:

```bash
npm run db:push:pg
```
*(Или: `npx prisma db push --schema=prisma/schema.postgresql.prisma`)*

При успешном выполнении Prisma создаст все таблицы (`User`, `Playlist`, `LikedTrack`, `HistoryItem`, `TrackCache`, `LyricsCache`).

---

## Шаг 9. Production-сборка проекта

Выполните единую команду сборки всех компонентов:

```bash
npm run build
```

Эта команда последовательно:
1. Компилирует TypeScript backend-сервер (`dist-server/`).
2. Копирует `ytdlp_worker.py` и генерирует Prisma Client.
3. Собирает оптимизированный production SPA бандл React (`dist/`).

---

## Шаг 10. Настройка и запуск процессов через PM2

**PM2** обеспечивает непрерывную работу бэкенда, автоматический перезапуск при сбоях и старт при перезагрузке VPS:

1. Установите PM2 глобально:
   ```bash
   sudo npm install -g pm2
   ```

2. Запустите приложения с помощью уже готового конфигурационного файла `ecosystem.config.cjs`:
   ```bash
   pm2 start ecosystem.config.cjs
   ```

3. Проверьте статус:
   ```bash
   pm2 status
   ```
   Вы увидите активный процесс со статусом `online`:
   * `oskolok-api`

4. Сохраните список процессов для автозапуска при рестарте ОС:
   ```bash
   pm2 save
   sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u ubuntu --hp /home/ubuntu
   ```

---

## Шаг 11. Настройка Nginx и SPA Fallback

1. Установите Nginx:
   ```bash
   sudo apt install -y nginx
   ```

2. Скопируйте готовый конфиг `nginx/oskolok.conf`:
   ```bash
   sudo cp nginx/oskolok.conf /etc/nginx/sites-available/oskolok
   ```

3. Откройте файл конфига и замените `your-domain.com` на ваш реальный домен (или публичный IP):
   ```bash
   sudo nano /etc/nginx/sites-available/oskolok
   ```

4. Активируйте конфигурацию и удалите дефолтный сайт:
   ```bash
   sudo ln -s /etc/nginx/sites-available/oskolok /etc/nginx/sites-enabled/
   sudo rm -f /etc/nginx/sites-enabled/default
   sudo nginx -t   # Проверка синтаксиса (должно вывести: syntax is ok / test is successful)
   sudo systemctl restart nginx
   ```

---

## Шаг 12. Получение бесплатного SSL-сертификата (HTTPS через Let's Encrypt)

Настройте защищенное соединение **HTTPS** для веб-плеера.

1. Направьте **A-запись** вашего домена в DNS-панели вашего регистратора на публичный IP-адрес вашего Oracle VPS.
2. Установите Certbot:
   ```bash
   sudo apt install -y certbot python3-certbot-nginx
   ```
3. Выпустите и примените SSL-сертификат:
   ```bash
   sudo certbot --nginx -d your-domain.com -d www.your-domain.com
   ```
4. Certbot автоматически обновит конфигурацию Nginx и настроит автопродление сертификата.

---

## Шаг 13. Проверка Healthcheck эндпоинта

Проверьте, что сервер работает и база данных подключена:

```bash
curl -i https://your-domain.com/api/health
```

Ожидаемый ответ:
```json
HTTP/2 200
{
  "status": "ok",
  "database": "ok",
  "soundcloud": "ok",
  "timestamp": "..."
}
```

---

## 🛠️ Полезные команды для обслуживания VPS

```bash
# Просмотр логов бэкенда в реальном времени
pm2 logs

# Просмотр логов конкретного процесса
pm2 logs oskolok-api

# Перезапуск сервисов после обновления кода
git pull
npm run build
pm2 restart all

# Мониторинг потребления ресурсов (CPU / RAM)
pm2 monit

# Проверка статуса Nginx
sudo systemctl status nginx
sudo nginx -t
sudo systemctl reload nginx
```
