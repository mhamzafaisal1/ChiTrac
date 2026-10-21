/** Angular imports */
import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';

/** Other module imports */
import { catchError, finalize, map, shareReplay } from 'rxjs/operators';
import { BehaviorSubject, Observable, of, throwError } from 'rxjs';

export const PermissionLevels = {
  utilities: 0,
  apiTokens: 1,
  serverLogs: 1,
  users: 2,
  operators: 4,
  reports: 4,
  shifts: 4,
  dashboards: 7,
  profile: 7,
  settings: 7
} as const;

@Injectable({
  providedIn: 'root'
})
export class UserService {
  private readonly userSubject: BehaviorSubject<User | null>;
  private currentUserRequest$: Observable<User | null> | null = null;
  private currentUserRequestToken: string | null = null;
  private sessionVersion = 0;
  private verifiedSession: { user: User; token: string | null; validUntil: number } | null = null;
  private readonly sessionFreshnessMs = 30_000;
  public readonly user: Observable<User | null>;

  constructor(
    private http: HttpClient
  ) {
    // Stored user data is display cache only; it must never authorize a route.
    this.userSubject = new BehaviorSubject<User | null>(null);
    this.user = this.userSubject.asObservable();
  }

  public postUserRegister(user: any) {
    // Return the full API response so callers can surface messages (success/error) to the user
    return this.http.post<any>('/api/passport/user/register', user).pipe(map(x => x));
  }

  public postUserLogin(user: any) {
    const headers = new HttpHeaders({ 'X-Skip-Error-Modal': 'true' });
    return this.http.post<any>('/api/passport/user/login', user, { headers }).pipe(map(x => {
      // store user details and jwt token in local storage to keep user logged in between page refreshes
      if (x.user && x.token) {
        this.invalidateVerifiedSession();
        localStorage.setItem('token', x.token);
        return this.rememberVerifiedUser(x.user, x.token);
      } else {
        this.clearStoredSession();
        return { username: null };
      }
    }));
  }

  public getCurrentUser(forceRefresh = false): Observable<User | null> {
    const token = this.getToken();
    if (this.tokenHasExpired(token)) {
      this.clearStoredSession();
      return of(null);
    }
    // Only an identity validated by the server in this running app may skip a request.
    // localStorage user data and decoded JWT permission claims never authorize a route.
    if (!forceRefresh && this.verifiedSession?.token === token &&
        this.verifiedSession.validUntil > Date.now()) {
      return of(this.verifiedSession.user);
    }
    if (this.currentUserRequest$ && this.currentUserRequestToken === token) {
      return this.currentUserRequest$;
    }

    const version = this.sessionVersion;
    const headers = new HttpHeaders({ 'X-Skip-Error-Modal': 'true' });
    const request$: Observable<User | null> = this.http.get<{ user?: User }>('/api/passport/user', { headers }).pipe(
      map(response => {
        if (version !== this.sessionVersion || token !== this.getToken()) return null;
        if (!response.user?.username) {
          this.clearStoredSession();
          return null;
        }

        return this.rememberVerifiedUser(response.user, token);
      }),
      catchError(error => {
        if (version !== this.sessionVersion || token !== this.getToken()) return of(null);
        if (error.status === 401 || error.status === 403) {
          this.clearStoredSession();
          return of(null);
        }
        // A network/server outage must not erase valid credentials. Navigation fails
        // closed, with the app's retry feedback, until verification succeeds.
        return throwError(() => error);
      }),
      finalize(() => {
        if (this.currentUserRequest$ === request$) this.currentUserRequest$ = null;
      }),
      shareReplay({ bufferSize: 1, refCount: true })
    );

    this.currentUserRequestToken = token;
    this.currentUserRequest$ = request$;
    return request$;
  }

  public logout() {
    this.invalidateVerifiedSession();
    return this.http.get<{username: string}>('/api/passport/user/logout').pipe(map(x => {
      // store user details and jwt token in local storage to keep user logged in between page refreshes
      this.clearStoredSession();
      return { username: null as string };
    }));
  }

  public clearStoredSession(): void {
    this.invalidateVerifiedSession();
    localStorage.removeItem('user');
    localStorage.removeItem('token');
    this.userSubject.next(null);
  }

  public invalidateSessionVerification(): void { this.invalidateVerifiedSession(); }

  private invalidateVerifiedSession(): void {
    this.sessionVersion += 1;
    this.verifiedSession = null;
    this.currentUserRequest$ = null;
  }

  private rememberVerifiedUser(user: User, token: string | null): User {
    const verified = token ? { ...user, token } : user;
    localStorage.setItem('user', JSON.stringify(verified));
    this.verifiedSession = { user: verified, token, validUntil: Date.now() + this.sessionFreshnessMs };
    this.userSubject.next(verified);
    return verified;
  }

  private tokenHasExpired(token: string | null): boolean {
    if (!token) return false;
    try {
      const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
      return typeof payload.exp === 'number' && payload.exp * 1000 <= Date.now();
    } catch {
      return false; // Token validity is checked by the server, not this expiry hint.
    }
  }

  public getToken(): string | null {
    return localStorage.getItem('token');
  }

  public hasPermissionLevel(requiredLevel: number, user: User | null = this.userSubject.value): boolean {
    const userLevel = user?.permissions?.level;
    return typeof userLevel === 'number' && userLevel <= requiredLevel;
  }

  public getPermissionLevel(user: User | null = this.userSubject.value, fallback = 3): number {
    const userLevel = user?.permissions?.level;
    return typeof userLevel === 'number' ? userLevel : fallback;
  }

  public getProfile() {
    return this.http.get<any>('/api/users/me').pipe(map(x => x));
  }

  public updateProfile(profile: any) {
    return this.http.put<any>('/api/users/me', profile).pipe(map(x => {
      if (x.user && x.token) {
        this.invalidateVerifiedSession();
        localStorage.setItem('token', x.token);
        this.rememberVerifiedUser(x.user, x.token);
      }
      return x;
    }));
  }
}

export class User {
  username: string;
  permissions?: {
    level: number;
  };
}
