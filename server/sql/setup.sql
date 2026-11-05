-- Tilenest: one-time database setup on the existing MariaDB (run as the MariaDB admin user).
-- Replace CHANGE_ME_STRONG_PASSWORD before running. Never commit the real password.
CREATE DATABASE IF NOT EXISTS tilenest CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- '%' lets the container connect from the docker network; narrow it (e.g. '172.18.%') if you prefer.
CREATE USER IF NOT EXISTS 'tilenest'@'%' IDENTIFIED BY 'CHANGE_ME_STRONG_PASSWORD';
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX ON tilenest.* TO 'tilenest'@'%';
FLUSH PRIVILEGES;
