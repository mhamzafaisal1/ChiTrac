import { Component } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatButtonModule } from '@angular/material/button';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatExpansionModule } from '@angular/material/expansion';

@Component({
    selector: 'app-ct-main-menu',
    imports: [MatIconModule, MatMenuModule, MatButtonModule, MatToolbarModule, MatExpansionModule],
    templateUrl: './ct-main-menu.component.html',
    styleUrl: './ct-main-menu.component.css'
})
export class CtMainMenuComponent {

}
