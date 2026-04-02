/** Angular imports */
import { Injectable } from '@angular/core';
import { Router } from '@angular/router';
import { HttpClient, HttpHeaders } from '@angular/common/http';

/** Other module imports */
import { map } from 'rxjs/operators';
import { BehaviorSubject, Observable } from 'rxjs';

export interface UserWithEmailRow {
  _id: string;
  emailAddress: string;
  local: { username: string };
}

/** Response from GET /api/passport/user/resetPassword/:token (password removed). */
export interface PasswordResetVerifyResponse {
  username?: string;
  emailAddress?: string;
  _id?: string;
}

export interface PasswordResetSubmitUser {
  _id: string;
  local: { username: string };
  emailAddress: string;
  newPassword: string;
}

@Injectable({
  providedIn: 'root'
})
export class UserService {
  private userSubject: BehaviorSubject<any>;
  public user: Observable<User | null>;

  constructor(
    private router: Router,
    private http: HttpClient
  ) {
    this.getCurrentUser().subscribe(x => x);
    this.userSubject = new BehaviorSubject(JSON.parse(localStorage.getItem('user')!));
    this.user = this.userSubject.asObservable();
  }

  public postUserRegister(user: any) {
    return this.http.post<any>('/api/passport/user/register', user).pipe(map(x => x));
  }

  /** POST body: { emailAddress } */
  public requestPasswordReset(emailAddress: string) {
    return this.http.post<{ ok?: boolean; message?: string }>(
      '/api/passport/user/requestPasswordReset',
      { emailAddress }
    );
  }

  /**
   * Verify reset JWT from email link path or ?token= query.
   * GET /api/passport/user/resetPassword/:token
   */
  public verifyPasswordResetToken(token: string) {
    const enc = encodeURIComponent(token);
    return this.http.get<PasswordResetVerifyResponse>(
      `/api/passport/user/resetPassword/${enc}`
    );
  }

  /** POST body: { user: { _id, local: { username }, emailAddress, newPassword } } */
  public postPasswordReset(userPayload: PasswordResetSubmitUser) {
    return this.http.post<{ ok?: boolean; message?: string }>(
      '/api/passport/user/resetPassword',
      { user: userPayload }
    );
  }

  public postUserLogin(user: any) {
    return this.http.post<any>('/api/passport/user/login', user).pipe(map(x => {
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

  public getCurrentUser() {
    return this.http.get<any>('/api/passport/user').pipe(map(x => {
      if (x.user) {
        localStorage.setItem('user', JSON.stringify(x.user));
        this.userSubject.next(x.user);
        return x.user;
      } else {
        localStorage.setItem('user', JSON.stringify({ username: null }));
        this.userSubject.next({ username: null });
        return { username: null };
      }
      
    }));
  }

  public logout() {
    return this.http.get<{username: string}>('/api/passport/user/logout').pipe(map(x => {
      localStorage.setItem('user', JSON.stringify({ username: null }));
      localStorage.removeItem('token');
      this.userSubject.next({ username: null });
      return { username: null as string };
    }));
  }

  public getToken(): string | null {
    return localStorage.getItem('token');
  }

  public getUsersWithEmail(): Observable<UserWithEmailRow[]> {
    const token = this.getToken();
    let headers = new HttpHeaders();
    if (token) {
      headers = headers.set('Authorization', `Bearer ${token}`);
    }
    return this.http
      .get<{ users: UserWithEmailRow[] }>('/api/passport/users/hasEmail', { headers })
      .pipe(map((r) => r.users ?? []));
  }
}

export class User {
  username: string;
  emailAddress?: string;
  _id?: string;
}
