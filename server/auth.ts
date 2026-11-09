// Accounts: register / login with username + password, one character per
// account (name + gender). Users are stored as JSON files in data/users/.
// Passwords are hashed with scrypt; sessions are stateless HMAC-signed tokens.
import { createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

export interface User {
  u: string;            // username (lowercase)
  salt: string;
  hash: string;
  pid: string;          // farm save id
  name: string;         // character name ('' = not created yet)
  gender: 'm' | 'f' | '';
  created: number;
}

export interface Profile { username: string; name: string; gender: string; hasCharacter: boolean }

const TOKEN_DAYS = 30;

export class Auth {
  private dir: string;
  private secret!: Buffer;
  private secretPath: string;
  /** login attempts per ip: [count, windowStart] */
  private tries = new Map<string, [number, number]>();

  constructor(dataDir: string) {
    this.dir = join(dataDir, 'users');
    this.secretPath = join(dataDir, 'secret.key');
  }

  async init() {
    await mkdir(this.dir, { recursive: true });
    if (process.env.AUTH_SECRET) { this.secret = Buffer.from(process.env.AUTH_SECRET); return; }
    try { this.secret = await readFile(this.secretPath); } catch {
      this.secret = randomBytes(32);
      await writeFile(this.secretPath, this.secret, { mode: 0o600 });
    }
  }

  private file(u: string) { return join(this.dir, u + '.json'); }

  async getUser(u: string): Promise<User | null> {
    try { return JSON.parse(await readFile(this.file(u), 'utf8')) as User; } catch { return null; }
  }

  private async saveUser(user: User) {
    await mkdir(this.dir, { recursive: true });
    const tmp = this.file(user.u) + '.tmp';
    await writeFile(tmp, JSON.stringify(user));
    await rename(tmp, this.file(user.u));
  }

  profile(u: User): Profile {
    return { username: u.u, name: u.name, gender: u.gender, hasCharacter: !!u.name };
  }

  /** returns an error message, or null when allowed */
  limit(ip: string): string | null {
    const now = Date.now();
    const t = this.tries.get(ip);
    if (!t || now - t[1] > 10 * 60 * 1000) { this.tries.set(ip, [1, now]); return null; }
    if (++t[0] > 20) return 'Thử quá nhiều lần, hãy đợi vài phút';
    return null;
  }

  sign(u: string): string {
    const exp = Date.now() + TOKEN_DAYS * 864e5;
    const body = `${u}.${exp}`;
    const mac = createHmac('sha256', this.secret).update(body).digest('base64url');
    return `${body}.${mac}`;
  }

  /** username from a valid token, or null */
  verify(token: string): string | null {
    const m = /^([a-z0-9_]{3,20})\.(\d+)\.([A-Za-z0-9_-]+)$/.exec(token || '');
    if (!m || Number(m[2]) < Date.now()) return null;
    const want = createHmac('sha256', this.secret).update(`${m[1]}.${m[2]}`).digest();
    const got = Buffer.from(m[3], 'base64url');
    return got.length === want.length && timingSafeEqual(got, want) ? m[1] : null;
  }

  async register(username: string, password: string): Promise<{ token: string; user: User } | string> {
    const u = String(username || '').trim().toLowerCase();
    if (!/^[a-z0-9_]{3,20}$/.test(u)) return 'Tên đăng nhập 3-20 ký tự: chữ không dấu, số, dấu _';
    if (typeof password !== 'string' || password.length < 6 || password.length > 72) return 'Mật khẩu từ 6 đến 72 ký tự';
    if (await this.getUser(u)) return 'Tên đăng nhập đã có người dùng';
    const salt = randomBytes(16);
    const hash = await scrypt(password, salt, 32);
    const user: User = {
      u, salt: salt.toString('hex'), hash: hash.toString('hex'),
      pid: randomBytes(12).toString('hex'), name: '', gender: '', created: Date.now(),
    };
    await this.saveUser(user);
    return { token: this.sign(u), user };
  }

  async login(username: string, password: string): Promise<{ token: string; user: User } | string> {
    const u = String(username || '').trim().toLowerCase();
    const user = /^[a-z0-9_]{3,20}$/.test(u) ? await this.getUser(u) : null;
    // hash anyway so timing does not reveal whether the user exists
    const salt = user ? Buffer.from(user.salt, 'hex') : randomBytes(16);
    const hash = await scrypt(String(password || ''), salt, 32);
    if (!user || !timingSafeEqual(hash, Buffer.from(user.hash, 'hex'))) return 'Sai tên đăng nhập hoặc mật khẩu';
    return { token: this.sign(u), user };
  }

  async setCharacter(u: string, name: string, gender: string): Promise<User | string> {
    const user = await this.getUser(u);
    if (!user) return 'Tài khoản không tồn tại';
    const n = String(name || '').normalize('NFC').trim().replace(/\s+/g, ' ');
    if (!/^[\p{L}\p{N} ]{2,16}$/u.test(n)) return 'Tên nhân vật 2-16 ký tự, chỉ gồm chữ, số và khoảng trắng';
    if (gender !== 'm' && gender !== 'f') return 'Hãy chọn nhân vật';
    user.name = n; user.gender = gender;
    await this.saveUser(user);
    return user;
  }
}
