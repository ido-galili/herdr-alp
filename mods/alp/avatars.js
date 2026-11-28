// Assignees' GitHub avatars, downloaded once into Herdr's home, where `image()` can draw them.
// An avatar shows only after its file is there, so a card never asks for a missing image.
// GitHub serves JPEG or PNG, so each file takes the extension of what it holds.

import { exec, home } from "herdr";

/** The avatars folder, relative to Herdr's home, as `image()` takes it. */
const AVATAR_DIR = "data/alp/avatars";
const EXTENSIONS = { "image/jpeg": "jpg", "image/png": "png", "image/gif": "gif" };

/** The file stem for a login: GitHub logins hold letters, digits and dashes. */
const stem = (login) => login.replace(/[^A-Za-z0-9-]/g, "_");

/** The absolute avatars folder. */
const folder = () => `${home()}/.config/herdr-app/${AVATAR_DIR}`;

export class Avatars {
  constructor() {
    /** Login stem to file name, for the avatars on disk. */
    this.files = new Map();
    this.busy = new Set();
    this.failed = new Set();
    this.listed = false;
  }

  /**
   * The avatar to draw for a login.
   * @param {string} login The GitHub login.
   * @returns {string | null} The path for `image()`, or null until the file is there.
   */
  path(login) {
    const file = this.files.get(stem(login));
    return file ? `${AVATAR_DIR}/${file}` : null;
  }

  /**
   * The people with an avatar URL and no file yet, no download under way, and no failed one.
   * @param {{ login: string, avatar?: string | null }[]} people The assignees.
   * @returns {{ login: string, avatar: string }[]}
   */
  missing(people) {
    const seen = new Set();
    return people.filter((person) => {
      const key = stem(person.login);
      if (!person.avatar || seen.has(key) || this.files.has(key) || this.busy.has(key) || this.failed.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }

  /**
   * Downloads the missing avatars. A failed download is not tried again until the mod reloads.
   * @param {{ login: string, avatar?: string | null }[]} people The assignees.
   * @returns {Promise<void>}
   */
  async load(people) {
    const wanted = this.missing(people);
    for (const { login } of wanted) this.busy.add(stem(login));
    if (!this.listed) {
      this.listed = true;
      const listing = await exec("ls", [folder()]).catch(() => null);
      for (const name of listing?.code === 0 ? listing.stdout.split("\n") : []) {
        const match = /^(.+)\.(jpg|png|gif)$/.exec(name);
        if (match) this.files.set(match[1], name);
      }
    }
    await Promise.all(wanted.map(({ login, avatar }) => this.download(stem(login), avatar)));
  }

  /**
   * Downloads one avatar, then names the file after the image type it holds.
   * @param {string} key The login's file stem.
   * @param {string} url The avatar URL.
   * @returns {Promise<void>}
   */
  async download(key, url) {
    const temporary = `${folder()}/${key}.tmp`;
    try {
      if (this.files.has(key)) return;
      const fetched = await exec("curl", ["-sfL", "--create-dirs", "-o", temporary, url], { timeout: 15000 });
      if (fetched.code !== 0) throw new Error(fetched.stderr.trim() || `curl exited ${fetched.code}`);
      const type = await exec("file", ["-b", "--mime-type", temporary]);
      const extension = EXTENSIONS[type.stdout.trim()];
      if (!extension) throw new Error(`not an image: ${type.stdout.trim()}`);
      const moved = await exec("mv", ["-f", temporary, `${folder()}/${key}.${extension}`]);
      if (moved.code !== 0) throw new Error(moved.stderr.trim());
      this.files.set(key, `${key}.${extension}`);
    } catch (error) {
      this.failed.add(key);
      console.log(`alp: avatar for ${key} failed: ${error.message ?? error}`);
    } finally {
      this.busy.delete(key);
    }
  }
}
