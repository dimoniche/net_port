"use strict";

const fs = require("fs");
const util = require("util");
const exec = util.promisify(require("child_process").exec);

const { Service } = require("feathers-knex");
const logger = require("../../logger");

const SYSTEMD_UNIT_DIR = "/etc/systemd/system";

async function isSystemdAvailable() {
    if (process.env.SKIP_USER_SYSTEMD === "true") {
        return false;
    }

    try {
        await exec("command -v systemctl");
    } catch {
        return false;
    }

    return fs.existsSync(SYSTEMD_UNIT_DIR);
}

function legacyServiceName(userId) {
    return `net_port_u${userId}`;
}

function legacyServiceFilePath(userId) {
    return `${SYSTEMD_UNIT_DIR}/${legacyServiceName(userId)}.service`;
}

function buildLegacyServiceUnit(userId) {
    return `[Unit]
Description=net port service user ${userId}
After=network.target auditd.service

[Service]
WorkingDirectory=/root/net_port
ExecStart=/bin/su -c "/home/net_port/module_net_port_server* --user ${userId} --cert server.crt --key server.key --threads 10"
User=root
Type=simple
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
`;
}

async function installLegacyUserService(userId) {
    if (!(await isSystemdAvailable())) {
        logger.info(
            "Skipping legacy systemd unit for user %s (systemd unavailable)",
            userId
        );
        return;
    }

    const filepath = legacyServiceFilePath(userId);

    try {
        if (!fs.existsSync(filepath)) {
            fs.writeFileSync(filepath, buildLegacyServiceUnit(userId), {
                flag: "wx",
            });
        }
    } catch (error) {
        logger.warn(
            "Failed to write legacy systemd unit for user %s: %s",
            userId,
            error.message
        );
        return;
    }

    try {
        await exec(`systemctl enable ${legacyServiceName(userId)}`);
    } catch (error) {
        logger.warn(
            "Failed to enable legacy systemd unit for user %s: %s",
            userId,
            error.message
        );
    }
}

async function removeLegacyUserService(userId) {
    if (!(await isSystemdAvailable())) {
        return;
    }

    const serviceName = legacyServiceName(userId);
    const filepath = legacyServiceFilePath(userId);

    try {
        await exec(`systemctl disable ${serviceName}`);
    } catch (error) {
        logger.warn(
            "Failed to disable legacy systemd unit for user %s: %s",
            userId,
            error.message
        );
    }

    try {
        if (fs.existsSync(filepath)) {
            fs.unlinkSync(filepath);
        }
    } catch (error) {
        logger.warn(
            "Failed to remove legacy systemd unit for user %s: %s",
            userId,
            error.message
        );
    }
}

exports.Users = class Users extends Service {
    constructor(options) {
        super({
            ...options,
            name: "users",
        });
        this.db1 = options.Model;
    }

    async update(id, data) {
        const updated = await this.db1
            .from("users")
            .where("id", Number(id))
            .update(data)
            .returning("*");

        return Array.isArray(updated) ? updated[0] : updated;
    }

    async remove(id) {
        const user = await this.get(id);
        if (user.login == "admin") {
            return user;
        }

        await this.db1.from("users").where("id", id).del();
        await removeLegacyUserService(id);

        return user;
    }

    async create(data) {
        const inserted = await this.db1
            .insert(data)
            .into("users")
            .returning("*");
        const user = Array.isArray(inserted) ? inserted[0] : inserted;

        await installLegacyUserService(user.id);

        return user;
    }
};
