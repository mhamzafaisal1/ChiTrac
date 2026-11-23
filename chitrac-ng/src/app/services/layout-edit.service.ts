import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, Subject, takeUntil } from 'rxjs';
import { UserService } from '../user.service';

export interface LayoutEditContext {
  id: string;
  label: string;
  editing: boolean;
  editsMade: boolean;
}

export interface LayoutEditSessionOptions {
  /** Context id the dashboard registered with. */
  id: string;
  destroyed: Observable<void>;
  isEditing: () => boolean;
  setEditing: (editing: boolean) => void;
  /** Entering edit mode: remember the current layout. */
  onEnter: () => void;
  /** Leaving edit mode: forget the remembered layout. */
  onExit: () => void;
  /** Lock pressed with unsaved edits: open the save/discard prompt and return its result. */
  confirm: () => Observable<unknown> | undefined;
  /** The user chose discard: put the remembered layout back and leave edit mode. */
  discard: () => void;
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

  /**
   * Edit session for one dashboard: viewing -> editing (snapshot taken) -> lock
   * with edits -> save/discard prompt -> saved, discarded (snapshot restored) or
   * kept editing. Unsubscribes when `destroyed` emits.
   */
  bindSession(options: LayoutEditSessionOptions): void {
    this.context$.pipe(takeUntil(options.destroyed)).subscribe(context => {
      const nextEditing = context?.id === options.id && context.editing;
      if (nextEditing && !options.isEditing()) options.onEnter();
      else if (!nextEditing && options.isEditing()) options.onExit();
      options.setEditing(nextEditing);
    });

    this.lockRequested$.pipe(takeUntil(options.destroyed)).subscribe(() => {
      options.confirm()?.pipe(takeUntil(options.destroyed)).subscribe(result => {
        if (result === 'discard') options.discard();
      });
    });
  }
}
