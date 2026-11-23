import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

export class ChatDto {
  @IsOptional()
  @IsUUID()
  conversationId?: string;

  /** Optional multi-bot assistant bound to a knowledge base */
  @IsOptional()
  @IsUUID()
  botId?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(8000)
  message!: string;

  @IsOptional()
  @IsBoolean()
  rewrite?: boolean;

  /** Research Mode (Phase 2 agent, read-only) */
  @IsOptional()
  @IsBoolean()
  research?: boolean;

  /** Prefer/filter to verified knowledge only */
  @IsOptional()
  @IsBoolean()
  verifiedOnly?: boolean;
}

export class UpdateConversationDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsIn(['active', 'archived'])
  status?: 'active' | 'archived';
}

export class FeedbackDto {
  @IsIn(['positive', 'negative'])
  rating!: 'positive' | 'negative';

  @IsOptional()
  @IsString()
  @MaxLength(100)
  reason?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  comment?: string;
}
