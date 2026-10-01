import { Injectable, PipeTransform, BadRequestException } from '@nestjs/common';
import * as Yup from 'yup';

@Injectable()
class YupValidationPipe implements PipeTransform {
  constructor(private schema: Yup.ISchema<any>) {}
  async transform(value: unknown) {
    try {
      // return the cast value: it is type-coerced and has unknown keys stripped
      return await this.schema.validate(value, { abortEarly: false });
    } catch (error) {
      if (error instanceof Yup.ValidationError) {
        throw new BadRequestException(error.errors, { cause: error });
      }
      throw error;
    }
  }
}

export { YupValidationPipe };
