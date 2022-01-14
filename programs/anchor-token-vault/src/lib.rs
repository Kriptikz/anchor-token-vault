use anchor_lang::prelude::*;

declare_id!("GX2r6F2RzNAoR54oZ3EgrDwnUYJvW24cJpZnBnULRGiV");

#[program]
pub mod anchor_token_vault {
    use super::*;
    pub fn initialize(ctx: Context<Initialize>) -> ProgramResult {
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize {}
