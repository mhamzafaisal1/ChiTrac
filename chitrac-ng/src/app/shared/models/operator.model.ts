import { Deserializable } from './deserializable.model';

export interface NameObject {
	first?: string;
	surname?: string;
	prefix?: string;
	suffix?: string;
	middle?: string;
	middleInitial?: string;
	additionalSurnames?: string[];
	lastFirst?: boolean;
}

export class OperatorConfig implements Deserializable {
	public _id: string;
	public code: number;
	public name: string | NameObject;
	public active: boolean;

	deserialize(input: any) {
        Object.assign(this, input);
        return this;
    }
}