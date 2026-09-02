import { app } from 'electron';
import https from 'node:https';
import { join } from 'node:path';
import type { CollectField, CollectionStepError } from '../../shared/domain';

export interface AccountCheckResult {
  nickname: string;
  grade: number;
}

export interface AuthorSearchResult {
  authorId: string;
  nickname: string;
  notRegistered: boolean;
}

export interface AuthorCollectionResult {
  status: 'ok' | 'partial' | 'failed';
  data: Record<string, unknown>;
  errors: CollectionStepError[];
}

export interface XingtuGateway {
  checkAccount(cookies: string, signal?: AbortSignal): Promise<AccountCheckResult>;
  searchAuthor(url: string, cookies: string, signal?: AbortSignal): Promise<AuthorSearchResult>;
  collectAuthor(
    authorId: string,
    cookies: string,
    fields: CollectField[],
    signal?: AbortSignal,
  ): Promise<AuthorCollectionResult>;
}

interface LegacyResult {
  success: boolean;
  message?: string;
  authorId?: string;
  nickName?: string;
  notRegistered?: boolean;
  data?: Record<string, unknown>;
  errors?: string[];
  hasErrors?: boolean;
}

interface LegacyXingtuApi {
  searchAuthorByDouyinUrl(url: string, cookies: string): Promise<LegacyResult>;
  collectBloggerData(authorId: string, cookies: string, fields: Record<string, boolean>): Promise<LegacyResult>;
}

const abortError = (): Error => new DOMException('操作已取消', 'AbortError');

const withAbort = async <T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> => {
  if (!signal) return promise;
  if (signal.aborted) throw abortError();
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(abortError());
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
};

const loadLegacyApi = (): LegacyXingtuApi => {
  const modulePath = join(app.getAppPath(), 'main', 'xingtuApi.js');
  return require(modulePath) as LegacyXingtuApi;
};

const requestJson = <T>(options: https.RequestOptions, signal?: AbortSignal): Promise<T> =>
  new Promise((resolve, reject) => {
    const request = https.request(options, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk: string) => {
        body += chunk;
      });
      response.on('end', () => {
        if (response.statusCode !== 200) {
          reject(new Error(`星图服务返回 HTTP ${response.statusCode ?? 0}`));
          return;
        }
        try {
          resolve(JSON.parse(body) as T);
        } catch {
          reject(new Error('星图服务返回了无法解析的数据'));
        }
      });
    });
    request.setTimeout(15_000, () => {
      request.destroy(new Error('请求超时'));
    });
    request.on('error', reject);
    const onAbort = (): void => {
      request.destroy(abortError());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    request.on('close', () => signal?.removeEventListener('abort', onAbort));
    request.end();
  });

export const createXingtuGateway = (): XingtuGateway => ({
  async checkAccount(cookies, signal) {
    const response = await requestJson<{
      name?: string;
      grade?: number;
      base_resp?: { status_code?: number; status_message?: string };
    }>(
      {
        hostname: 'www.xingtu.cn',
        port: 443,
        path: '/gw/api/demander/grade_info',
        method: 'GET',
        headers: {
          accept: 'application/json, text/plain, */*',
          'accept-language': 'zh-CN,zh;q=0.9',
          'agw-js-conv': 'str',
          referer: 'https://www.xingtu.cn/ad/user-center/user/equities',
          'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/143 Safari/537.36',
          Cookie: cookies,
          'x-login-source': '1',
        },
      },
      signal,
    );
    if (response.base_resp?.status_code !== 0) {
      throw new Error(response.base_resp?.status_message || '账号验证失败');
    }
    return { nickname: response.name ?? '', grade: response.grade ?? 0 };
  },

  async searchAuthor(url, cookies, signal) {
    const result = await withAbort(loadLegacyApi().searchAuthorByDouyinUrl(url, cookies), signal);
    if (!result.success) throw new Error(result.message || '未找到星图达人');
    return {
      authorId: result.authorId ?? '',
      nickname: result.nickName ?? '',
      notRegistered: result.notRegistered ?? false,
    };
  },

  async collectAuthor(authorId, cookies, fields, signal) {
    const selected = Object.fromEntries(fields.map((field) => [field, true]));
    const result = await withAbort(loadLegacyApi().collectBloggerData(authorId, cookies, selected), signal);
    const errors = (result.errors ?? []).map((message) => ({
      step: message.split(':', 1)[0] || 'unknown',
      message,
      retryable: true,
    }));
    const data = result.data ?? {};
    const usefulFieldCount = Object.keys(data).filter((key) => key !== 'authorId' && key !== '采集错误').length;
    if (!result.success || usefulFieldCount === 0) {
      return { status: 'failed', data, errors };
    }
    return { status: result.hasErrors || errors.length > 0 ? 'partial' : 'ok', data, errors };
  },
});