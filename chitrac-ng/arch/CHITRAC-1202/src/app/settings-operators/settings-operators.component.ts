import { Component } from '@angular/core';

import { MatCardModule } from '@angular/material/card';

import { OperatorGridComponent } from '../operator-grid/operator-grid.component';

import { OperatorConfig } from '../shared/models/operator.model';

@Component({
    selector: 'settings-operators',
    imports: [MatCardModule, OperatorGridComponent],
    templateUrl: './settings-operators.component.html',
    styleUrl: './settings-operators.component.scss'
})
export class SettingsOperatorsComponent {

}
