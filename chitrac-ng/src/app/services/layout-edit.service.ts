import { Injectable } from '@angular/core';
import { BehaviorSubject, Subject } from 'rxjs';

export interface LayoutEditContext {
  id: string;
  label: string;
  editing: boolean;
}

@Injectable({
  providedIn: 'root'
})
export class LayoutEditService {
  private contextSubject = new BehaviorSubject<LayoutEditContext | null>(null);
  readonly context$ = this.contextSubject.asObservable();
  private lockRequestedSubject = new Subject<void>();
  readonly lockRequested$ = this.lockRequestedSubject.asObservable();

  register(id: string, label: string): void {
    this.contextSubject.next({ id, label, editing: false });
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
      this.lockRequestedSubject.next();
      return;
    }

    this.contextSubject.next({ ...context, editing: true });
  }

  setEditing(editing: boolean): void {
    const context = this.contextSubject.value;
    if (!context) return;
    this.contextSubject.next({ ...context, editing });
  }
}
