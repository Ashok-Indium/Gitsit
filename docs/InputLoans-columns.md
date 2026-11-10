# InputLoans columns

Input file header, SQL column in `dbo.InputLoans`, and type. Generated from the app's table definition.

| Input file header | SQL column | Type |
|---|---|---|
| Loan ID | `loan_id` | NVARCHAR(50) |
| Pool | `pool` | NVARCHAR(400) |
| Arrearage | `arrearage` | DECIMAL(28,10) |
| As-Of Date | `as_of_date` | DATETIME2 |
| Sort | `sort` | DECIMAL(28,10) |
| Carve | `carve` | NVARCHAR(400) |
| Group | `group` | NVARCHAR(400) |
| Dups | `dups` | NVARCHAR(400) |
| Lien | `lien` | DECIMAL(28,10) |
| Prop Address | `prop_address` | NVARCHAR(400) |
| Prop City | `prop_city` | NVARCHAR(400) |
| Prop State | `prop_state` | NVARCHAR(400) |
| Prop Zip | `prop_zip` | DECIMAL(28,10) |
| Prop County | `prop_county` | NVARCHAR(400) |
| Prop MSA | `prop_msa` | NVARCHAR(400) |
| Prop Type | `prop_type` | NVARCHAR(400) |
| # Units | `num_units` | DECIMAL(28,10) |
| # Properties | `num_properties` | NVARCHAR(400) |
| BPO Repaired | `bpo_repaired` | NVARCHAR(400) |
| BPO As-Is | `bpo_as_is` | DECIMAL(28,10) |
| BPO QS | `bpo_qs` | NVARCHAR(400) |
| Cur List Px | `cur_list_px` | NVARCHAR(400) |
| Value Type | `value_type` | NVARCHAR(400) |
| Value Date | `value_date` | NVARCHAR(400) |
| Occupancy Current | `occupancy_current` | NVARCHAR(400) |
| Occupancy Original | `occupancy_original` | NVARCHAR(400) |
| Condition | `condition` | NVARCHAR(400) |
| Comment / Rating | `comment_rating` | NVARCHAR(400) |
| Location | `location` | NVARCHAR(400) |
| Annual Taxes | `annual_taxes` | NVARCHAR(400) |
| HOA | `hoa` | NVARCHAR(400) |
| Listed | `listed` | NVARCHAR(400) |
| Age | `age` | NVARCHAR(400) |
| Year Built | `year_built` | NVARCHAR(400) |
| Sqft | `sqft` | NVARCHAR(400) |
| Beds | `beds` | NVARCHAR(400) |
| Baths | `baths` | NVARCHAR(400) |
| Disclosure | `disclosure` | NVARCHAR(400) |
| Orig AIV Date | `orig_aiv_date` | NVARCHAR(400) |
| Orig ARV Date | `orig_arv_date` | NVARCHAR(400) |
| Orig AIV | `orig_aiv` | NVARCHAR(400) |
| Orig ARV | `orig_arv` | NVARCHAR(400) |
| Orig Rehab Budget | `orig_rehab_budget` | NVARCHAR(400) |
| Rehab Reserve/Holdback | `rehab_reserve_holdback` | NVARCHAR(400) |
| Rehab Amount Drawn | `rehab_amount_drawn` | NVARCHAR(400) |
| Rehab Draws Remaining | `rehab_draws_remaining` | NVARCHAR(400) |
| GUC / New Construction Flag | `guc_new_construction_flag` | NVARCHAR(400) |
| BPO Repairs $ | `bpo_repairs_usd` | NVARCHAR(400) |
| Unnamed: 48 | `unnamed_48` | NVARCHAR(400) |
| Unnamed: 49 | `unnamed_49` | NVARCHAR(400) |
| UPB Accruing | `upb_accruing` | DECIMAL(28,10) |
| UPB Deferred | `upb_deferred` | NVARCHAR(400) |
| Escrow Advances | `escrow_advances` | NVARCHAR(400) |
| Corp Advances | `corp_advances` | DECIMAL(28,10) |
| Late Fees & Other | `late_fees_and_other` | DECIMAL(28,10) |
| Junior Lien Bal | `junior_lien_bal` | NVARCHAR(400) |
| Default Rate | `default_rate` | NVARCHAR(400) |
| Curr Rate | `curr_rate` | DECIMAL(28,10) |
| Curr P&I | `curr_p_and_i` | DECIMAL(28,10) |
| Curr T&I | `curr_t_and_i` | NVARCHAR(400) |
| Curr PITI | `curr_piti` | NVARCHAR(400) |
| Note Next Due Date | `note_next_due_date` | DATETIME2 |
| Orig Date | `orig_date` | DATETIME2 |
| Orig First Pay Date | `orig_first_pay_date` | DATETIME2 |
| Orig Maturity Date | `orig_maturity_date` | NVARCHAR(400) |
| Orig Sched Term | `orig_sched_term` | NVARCHAR(400) |
| Orig Amort Term | `orig_amort_term` | NVARCHAR(400) |
| Orig UPB | `orig_upb` | NVARCHAR(400) |
| Orig Rate | `orig_rate` | DECIMAL(28,10) |
| Orig P&I | `orig_p_and_i` | NVARCHAR(400) |
| Orig Appraisal | `orig_appraisal` | NVARCHAR(400) |
| Orig Sales Px | `orig_sales_px` | NVARCHAR(400) |
| Orig Appr Date | `orig_appr_date` | NVARCHAR(400) |
| Orig LTV | `orig_ltv` | NVARCHAR(400) |
| Orig CLTV | `orig_cltv` | NVARCHAR(400) |
| Orig FICO | `orig_fico` | NVARCHAR(400) |
| Orig FICO date | `orig_fico_date` | NVARCHAR(400) |
| Orig Frontend DTI | `orig_frontend_dti` | NVARCHAR(400) |
| Orig Backend DTI | `orig_backend_dti` | NVARCHAR(400) |
| Orig DSCR | `orig_dscr` | NVARCHAR(400) |
| Loan Type | `loan_type` | NVARCHAR(400) |
| BPL Bridge Flag | `bpl_bridge_flag` | NVARCHAR(400) |
| BPL Rehab Flag | `bpl_rehab_flag` | NVARCHAR(400) |
| BPL DSCR Flag | `bpl_dscr_flag` | NVARCHAR(400) |
| BPL Extension Flag | `bpl_extension_flag` | NVARCHAR(400) |
| BPL # Extensions | `bpl_num_extensions` | NVARCHAR(400) |
| BPL Personal Guaranty | `bpl_personal_guaranty` | NVARCHAR(400) |
| FHA Flag | `fha_flag` | NVARCHAR(400) |
| VA Flag | `va_flag` | NVARCHAR(400) |
| GSE Flag | `gse_flag` | NVARCHAR(400) |
| HUD PSR Flag | `hud_psr_flag` | NVARCHAR(400) |
| FNMA PSR Flag | `fnma_psr_flag` | NVARCHAR(400) |
| FRE PSR Flag | `fre_psr_flag` | NVARCHAR(400) |
| PSR Expiration Date | `psr_expiration_date` | NVARCHAR(400) |
| Product Type | `product_type` | NVARCHAR(400) |
| Doc Type | `doc_type` | NVARCHAR(400) |
| Loan Purpose | `loan_purpose` | NVARCHAR(400) |
| Mod Flag | `mod_flag` | NVARCHAR(400) |
| Mod Type | `mod_type` | NVARCHAR(400) |
| Mod Date | `mod_date` | DATETIME2 |
| Mod First Pay Date | `mod_first_pay_date` | NVARCHAR(400) |
| Mod Maturity Date | `mod_maturity_date` | NVARCHAR(400) |
| Mod Sched Term | `mod_sched_term` | NVARCHAR(400) |
| Mod Amort Term | `mod_amort_term` | NVARCHAR(400) |
| PreMod UPB | `premod_upb` | NVARCHAR(400) |
| Mod UPB | `mod_upb` | NVARCHAR(400) |
| PreMod Rate | `premod_rate` | NVARCHAR(400) |
| Mod Rate | `mod_rate` | NVARCHAR(400) |
| PreMod P&I | `premod_p_and_i` | NVARCHAR(400) |
| Mod P&I | `mod_p_and_i` | NVARCHAR(400) |
| Current Sched Term | `current_sched_term` | DECIMAL(28,10) |
| Current Amort Term | `current_amort_term` | NVARCHAR(400) |
| Current First Pay Date | `current_first_pay_date` | NVARCHAR(400) |
| Current Maturity Date | `current_maturity_date` | DATETIME2 |
| Unnamed: 114 | `unnamed_114` | NVARCHAR(400) |
| Remaining Term | `remaining_term` | DECIMAL(28,10) |
| Rate Type | `rate_type` | NVARCHAR(400) |
| Interest Calc Method | `interest_calc_method` | NVARCHAR(400) |
| IO Flag | `io_flag` | NVARCHAR(400) |
| IO Term | `io_term` | NVARCHAR(400) |
| IO End | `io_end` | NVARCHAR(400) |
| Balloon Flag | `balloon_flag` | NVARCHAR(400) |
| NegAm Flag | `negam_flag` | NVARCHAR(400) |
| NegAm Pct | `negam_pct` | NVARCHAR(400) |
| MI Co | `mi_co` | NVARCHAR(400) |
| MI Pct | `mi_pct` | NVARCHAR(400) |
| Curr Frontend DTI | `curr_frontend_dti` | NVARCHAR(400) |
| Curr Backend DTI | `curr_backend_dti` | NVARCHAR(400) |
| Curr FICO | `curr_fico` | NVARCHAR(400) |
| Curr FICO date | `curr_fico_date` | NVARCHAR(400) |
| Employed | `employed` | NVARCHAR(400) |
| Employment Date | `employment_date` | NVARCHAR(400) |
| Self Flag | `self_flag` | NVARCHAR(400) |
| Income | `income` | NVARCHAR(400) |
| Income Date | `income_date` | NVARCHAR(400) |
| Unnamed: 135 | `unnamed_135` | NVARCHAR(400) |
| Seller Status | `seller_status` | NVARCHAR(400) |
| FCL Flag | `fcl_flag` | NVARCHAR(400) |
| BK Flag | `bk_flag` | NVARCHAR(400) |
| REO Flag | `reo_flag` | NVARCHAR(400) |
| FCL Status | `fcl_status` | NVARCHAR(400) |
| FCL Hold | `fcl_hold` | NVARCHAR(400) |
| FCL Hold Date | `fcl_hold_date` | NVARCHAR(400) |
| FCL Contested | `fcl_contested` | NVARCHAR(400) |
| FCL Milestone | `fcl_milestone` | NVARCHAR(400) |
| FCL Milestone Date | `fcl_milestone_date` | NVARCHAR(400) |
| FCL Referral | `fcl_referral` | NVARCHAR(400) |
| FCL First Legal | `fcl_first_legal` | NVARCHAR(400) |
| FCL Service Complete | `fcl_service_complete` | NVARCHAR(400) |
| FCL Judgment | `fcl_judgment` | NVARCHAR(400) |
| FCL Sale Sched | `fcl_sale_sched` | NVARCHAR(400) |
| FCL Sale Held | `fcl_sale_held` | NVARCHAR(400) |
| BK Status | `bk_status` | NVARCHAR(400) |
| BK Status Date | `bk_status_date` | NVARCHAR(400) |
| BK Chapter | `bk_chapter` | NVARCHAR(400) |
| BK Filing Date | `bk_filing_date` | NVARCHAR(400) |
| BK Post Petition Due Date | `bk_post_petition_due_date` | NVARCHAR(400) |
| BK POC Filed | `bk_poc_filed` | NVARCHAR(400) |
| BK POC Bar Date | `bk_poc_bar_date` | NVARCHAR(400) |
| BK TOC Filed | `bk_toc_filed` | NVARCHAR(400) |
| BK Relief Request Date | `bk_relief_request_date` | NVARCHAR(400) |
| BK Relief Granted Date | `bk_relief_granted_date` | NVARCHAR(400) |
| BK Dismissal Date | `bk_dismissal_date` | NVARCHAR(400) |
| BK Discharge Date | `bk_discharge_date` | NVARCHAR(400) |
| BK End Date | `bk_end_date` | NVARCHAR(400) |
| BK End Reason | `bk_end_reason` | NVARCHAR(400) |
| BK Count | `bk_count` | NVARCHAR(400) |
| BK Notes | `bk_notes` | NVARCHAR(400) |
| LM COVID Active | `lm_covid_active` | NVARCHAR(400) |
| LM COVID Prior | `lm_covid_prior` | NVARCHAR(400) |
| LM COVID Deferral Date | `lm_covid_deferral_date` | NVARCHAR(400) |
| LM COVID Plan Start Date | `lm_covid_plan_start_date` | NVARCHAR(400) |
| LM COVID Plan End Date | `lm_covid_plan_end_date` | NVARCHAR(400) |
| LM Flag | `lm_flag` | NVARCHAR(400) |
| LM Status | `lm_status` | NVARCHAR(400) |
| LM Date | `lm_date` | NVARCHAR(400) |
| BWR Reason for Default | `bwr_reason_for_default` | NVARCHAR(400) |
| BWR Estate or Deceased | `bwr_estate_or_deceased` | NVARCHAR(400) |
| BWR Litigation | `bwr_litigation` | NVARCHAR(400) |
| BWR Cease & Desist | `bwr_cease_and_desist` | NVARCHAR(400) |
| BWR SCRA | `bwr_scra` | NVARCHAR(400) |
| Unnamed: 181 | `unnamed_181` | NVARCHAR(400) |
| CF$ t-24 | `cf_usd_t_24` | NVARCHAR(400) |
| CF$ t-23 | `cf_usd_t_23` | NVARCHAR(400) |
| CF$ t-22 | `cf_usd_t_22` | NVARCHAR(400) |
| CF$ t-21 | `cf_usd_t_21` | NVARCHAR(400) |
| CF$ t-20 | `cf_usd_t_20` | NVARCHAR(400) |
| CF$ t-19 | `cf_usd_t_19` | NVARCHAR(400) |
| CF$ t-18 | `cf_usd_t_18` | NVARCHAR(400) |
| CF$ t-17 | `cf_usd_t_17` | NVARCHAR(400) |
| CF$ t-16 | `cf_usd_t_16` | NVARCHAR(400) |
| CF$ t-15 | `cf_usd_t_15` | NVARCHAR(400) |
| CF$ t-14 | `cf_usd_t_14` | NVARCHAR(400) |
| CF$ t-13 | `cf_usd_t_13` | NVARCHAR(400) |
| CF$ t-12 | `cf_usd_t_12` | NVARCHAR(400) |
| CF$ t-11 | `cf_usd_t_11` | NVARCHAR(400) |
| CF$ t-10 | `cf_usd_t_10` | NVARCHAR(400) |
| CF$ t-09 | `cf_usd_t_09` | NVARCHAR(400) |
| CF$ t-08 | `cf_usd_t_08` | NVARCHAR(400) |
| CF$ t-07 | `cf_usd_t_07` | NVARCHAR(400) |
| CF$ t-06 | `cf_usd_t_06` | NVARCHAR(400) |
| CF$ t-05 | `cf_usd_t_05` | NVARCHAR(400) |
| CF$ t-04 | `cf_usd_t_04` | NVARCHAR(400) |
| CF$ t-03 | `cf_usd_t_03` | NVARCHAR(400) |
| CF$ t-02 | `cf_usd_t_02` | NVARCHAR(400) |
| CF$ t-01 | `cf_usd_t_01` | NVARCHAR(400) |
| CF$ cur | `cf_usd_cur` | NVARCHAR(400) |
| Last Payment Date | `last_payment_date` | NVARCHAR(400) |
| Paystring | `paystring` | NVARCHAR(400) |
| x30 | `x30` | NVARCHAR(400) |
| x60 | `x60` | NVARCHAR(400) |
| x90 | `x90` | NVARCHAR(400) |
| Due Date t-25 | `due_date_t_25` | NVARCHAR(400) |
| Due Date t-24 | `due_date_t_24` | NVARCHAR(400) |
| Due Date t-23 | `due_date_t_23` | NVARCHAR(400) |
| Due Date t-22 | `due_date_t_22` | NVARCHAR(400) |
| Due Date t-21 | `due_date_t_21` | NVARCHAR(400) |
| Due Date t-20 | `due_date_t_20` | NVARCHAR(400) |
| Due Date t-19 | `due_date_t_19` | NVARCHAR(400) |
| Due Date t-18 | `due_date_t_18` | NVARCHAR(400) |
| Due Date t-17 | `due_date_t_17` | NVARCHAR(400) |
| Due Date t-16 | `due_date_t_16` | NVARCHAR(400) |
| Due Date t-15 | `due_date_t_15` | NVARCHAR(400) |
| Due Date t-14 | `due_date_t_14` | NVARCHAR(400) |
| Due Date t-13 | `due_date_t_13` | NVARCHAR(400) |
| Due Date t-12 | `due_date_t_12` | NVARCHAR(400) |
| Due Date t-11 | `due_date_t_11` | NVARCHAR(400) |
| Due Date t-10 | `due_date_t_10` | NVARCHAR(400) |
| Due Date t-09 | `due_date_t_09` | NVARCHAR(400) |
| Due Date t-08 | `due_date_t_08` | NVARCHAR(400) |
| Due Date t-07 | `due_date_t_07` | NVARCHAR(400) |
| Due Date t-06 | `due_date_t_06` | NVARCHAR(400) |
| Due Date t-05 | `due_date_t_05` | NVARCHAR(400) |
| Due Date t-04 | `due_date_t_04` | NVARCHAR(400) |
| Due Date t-03 | `due_date_t_03` | NVARCHAR(400) |
| Due Date t-02 | `due_date_t_02` | NVARCHAR(400) |
| Due Date t-01 | `due_date_t_01` | NVARCHAR(400) |
| Due Date cur | `due_date_cur` | NVARCHAR(400) |
| Unnamed: 238 | `unnamed_238` | NVARCHAR(400) |
| Title | `title` | NVARCHAR(400) |
| Unnamed: 240 | `unnamed_240` | NVARCHAR(400) |
| TPOL | `tpol` | NVARCHAR(400) |
| Note | `note` | NVARCHAR(400) |
| Allonge | `allonge` | NVARCHAR(400) |
| Endorsement | `endorsement` | NVARCHAR(400) |
| Mortgage | `mortgage` | NVARCHAR(400) |
| AOM | `aom` | NVARCHAR(400) |
| Collateral Exceptions | `collateral_exceptions` | NVARCHAR(400) |
| Lien Enforcement Flag | `lien_enforcement_flag` | NVARCHAR(400) |
| High Cost Loan | `high_cost_loan` | NVARCHAR(400) |
| HUD-1 | `hud_1` | NVARCHAR(400) |
| TIL | `til` | NVARCHAR(400) |
| Texas Cashout | `texas_cashout` | NVARCHAR(400) |
| Modification | `modification` | NVARCHAR(400) |
| ATR | `atr` | NVARCHAR(400) |
| QM | `qm` | NVARCHAR(400) |
| TRID | `trid` | NVARCHAR(400) |
| Compliance Exceptions | `compliance_exceptions` | NVARCHAR(400) |
| Compliance Grade | `compliance_grade` | NVARCHAR(400) |
| RPL Resale Flag | `rpl_resale_flag` | NVARCHAR(400) |
| Disclosure 1 | `disclosure_1` | NVARCHAR(400) |
| Disclosure 2 | `disclosure_2` | NVARCHAR(400) |
| Originator | `originator` | NVARCHAR(400) |
| Current Servicer | `current_servicer` | NVARCHAR(400) |
| ST Date | `st_date` | NVARCHAR(400) |
| Prior Servicer | `prior_servicer` | NVARCHAR(400) |
