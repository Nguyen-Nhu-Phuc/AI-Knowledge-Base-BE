import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class SearchDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  query!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  topK?: number;

  /** Only return chunks from verified (non-expired) documents */
  @IsOptional()
  @IsBoolean()
  verifiedOnly?: boolean;
}
