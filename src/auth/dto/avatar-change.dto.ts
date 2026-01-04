import { IsNotEmpty } from 'class-validator';

export class AvatarChangeDto {

  @IsNotEmpty()
  avatarId: string;
}
