/** Angular imports */
import { Injectable } from '@angular/core';
import { Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';

/** Other module imports */
import { map } from 'rxjs/operators';
import { BehaviorSubject, Observable } from 'rxjs';

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
    // Return the full API response so callers can surface messages (success/error) to the user
    return this.http.post<any>('/api/passport/user/register', user).pipe(map(x => x));
  }

  public postUserLogin(user: any) {
    return this.http.post<any>('/api/passport/user/login', user).pipe(map(x => {
      // store user details and jwt token in local storage to keep user logged in between page refreshes
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

  public getCurrentUser() {
    return this.http.get<any>('/api/passport/user').pipe(map(x => {
      // store user details and jwt token in local storage to keep user logged in between page refreshes
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
      // store user details and jwt token in local storage to keep user logged in between page refreshes
      localStorage.setItem('user', JSON.stringify({ username: null }));
      this.userSubject.next({ username: null });
      return { username: null as string };
    }));
  }
}

export class User {
  username: string;
}
