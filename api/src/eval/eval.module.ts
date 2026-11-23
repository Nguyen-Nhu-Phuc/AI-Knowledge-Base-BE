import { Module } from '@nestjs/common';
import { EvalController } from './eval.controller';
import { EvalService } from './eval.service';
import { SearchModule } from '../search/search.module';

@Module({
  imports: [SearchModule],
  controllers: [EvalController],
  providers: [EvalService],
})
export class EvalModule {}
