/** Angular imports */
import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';

/** Other module imports */
import { catchError, finalize, map, shareReplay } from 'rxjs/operators';
import { BehaviorSubject, Observable, of } from 'rxjs';

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
        const userWithToken = { ...x.user, token: x.token };
        localStorage.setItem('user', JSON.stringify(userWithToken));
        localStorage.setItem('token', x.token);
        this.userSubject.next(userWithToken);
        return userWithToken;
      } else {
        localStorage.setItem('user', JSON.stringify({ username: null }));
        localStorage.removeItem('token');
        this.userSubject.next({ username: null });
        return { username: null };
      }
    }));
  }

  public getCurrentUser(): Observable<User | null> {
    if (this.currentUserRequest$) {
      return this.currentUserRequest$;
    }

    const headers = new HttpHeaders({ 'X-Skip-Error-Modal': 'true' });
    this.currentUserRequest$ = this.http.get<{ user?: User }>('/api/passport/user', { headers }).pipe(
      map(response => {
        if (!response.user?.username) {
          this.clearStoredSession();
          return null;
        }

        const token = localStorage.getItem('token');
        const userWithToken = token ? { ...response.user, token } : response.user;
        localStorage.setItem('user', JSON.stringify(userWithToken));
        this.userSubject.next(userWithToken);
        return userWithToken;
      }),
      catchError(() => {
        this.clearStoredSession();
        return of(null);
      }),
      finalize(() => {
        this.currentUserRequest$ = null;
      }),
      shareReplay({ bufferSize: 1, refCount: false })
    );

    return this.currentUserRequest$;
  }

  public logout() {
    return this.http.get<{username: string}>('/api/passport/user/logout').pipe(map(x => {
      // store user details and jwt token in local storage to keep user logged in between page refreshes
      localStorage.setItem('user', JSON.stringify({ username: null }));
      localStorage.removeItem('token');
      this.userSubject.next({ username: null });
      return { username: null as string };
    }));
  }

  public clearStoredSession(): void {
    localStorage.removeItem('user');
    localStorage.removeItem('token');
    this.userSubject.next(null);
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
        const userWithToken = { ...x.user, token: x.token };
        localStorage.setItem('user', JSON.stringify(userWithToken));
        localStorage.setItem('token', x.token);
        this.userSubject.next(userWithToken);
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
