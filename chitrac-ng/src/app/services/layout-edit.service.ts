import { Injectable } from '@angular/core';
import { BehaviorSubject, Subject } from 'rxjs';
import { UserService } from '../user.service';

export interface LayoutEditContext {
  id: string;
  label: string;
  editing: boolean;
  editsMade: boolean;
}

@Injectable({
  providedIn: 'root'
})
export class LayoutEditService {
  private contextSubject = new BehaviorSubject<LayoutEditContext | null>(null);
  readonly context$ = this.contextSubject.asObservable();
  private lockRequestedSubject = new Subject<void>();
  readonly lockRequested$ = this.lockRequestedSubject.asObservable();

  constructor(private userService: UserService) {}

  register(id: string, label: string): void {
    this.contextSubject.next({ id, label, editing: false, editsMade: false });
  }

  unregister(id: string): void {
    if (this.contextSubject.value?.id === id) {
      this.contextSubject.next(null);
    }
  }

  toggle(): void {
    const context = this.contextSubject.value;
    if (!context) return;

    if (context.editing) {
      if (!context.editsMade) {
        this.contextSubject.next({ ...context, editing: false, editsMade: false });
        return;
      }

      this.lockRequestedSubject.next();
      return;
    }

    if (!this.userService.getToken()) return;

    this.contextSubject.next({ ...context, editing: true, editsMade: false });
  }

  setEditing(editing: boolean): void {
    const context = this.contextSubject.value;
    if (!context) return;
    this.contextSubject.next({ ...context, editing, editsMade: editing ? context.editsMade : false });
  }

  markEditsMade(): void {
    const context = this.contextSubject.value;
    if (!context?.editing) return;
    this.contextSubject.next({ ...context, editsMade: true });
  }
}
