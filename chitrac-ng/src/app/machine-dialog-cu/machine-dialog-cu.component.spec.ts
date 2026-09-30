import { FormControl } from '@angular/forms';

import { addressListValidator } from './machine-dialog-cu.component';

describe('addressListValidator', () => {
  const validator = addressListValidator();

  it('accepts one through eight addresses', () => {
    expect(validator(new FormControl('1'))).toBeNull();
    expect(validator(new FormControl('1, 2, 3, 4, 5, 6, 7, 8'))).toBeNull();
  });

  it('rejects more than eight addresses', () => {
    expect(validator(new FormControl('1,2,3,4,5,6,7,8,9'))).toEqual({
      maxAddresses: { max: 8, actual: 9 }
    });
  });

  it('rejects malformed or non-positive addresses', () => {
    expect(validator(new FormControl('1, two'))).toEqual({ addressList: true });
    expect(validator(new FormControl('0'))).toEqual({ addressList: true });
  });

  it('leaves empty-value handling to the required validator', () => {
    expect(validator(new FormControl(''))).toBeNull();
  });
});
