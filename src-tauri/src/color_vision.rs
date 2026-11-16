//! Experimental full-screen colour-vision assistance and its ownership policy.
//!
//! A deficiency *simulation* is not a correction. For each profile, we build
//! `C = I + strength * R * (I - S)`: S estimates lost information, R shifts
//! that information towards other channels, and C is what is actually applied.
//! S uses Machado, Oliveira and Fernandes (2009), severity 1.0:
//! <https://doi.org/10.1109/TVCG.2009.113>. Type-specific R follows the
//! error-redistribution idea described at
//! <https://ixora.io/projects/colorblindness/color-blindness-simulation-research.html>.
//!
//! Those models are defined for linear-light RGB. A single Magnification API
//! 5x5 matrix cannot decode and re-encode sRGB, or perform content-aware gamut
//! mapping; Windows' actual colour pipeline varies. Thus this is an approximate
//! recolouring aid, NOT a faithful implementation of the published model, a
//! simulation, a diagnosis, or a guarantee of improved discrimination.

pub type Matrix = [[f32; 5]; 5];

pub const IDENTITY: Matrix = [
    [1.0, 0.0, 0.0, 0.0, 0.0],
    [0.0, 1.0, 0.0, 0.0, 0.0],
    [0.0, 0.0, 1.0, 0.0, 0.0],
    [0.0, 0.0, 0.0, 1.0, 0.0],
    [0.0, 0.0, 0.0, 0.0, 1.0],
];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Profile { Off, Protanopia, Deuteranopia, Tritanopia }

impl Profile {
    /// Unknown stored strings fail closed rather than resetting other settings.
    pub fn parse(value: &str) -> Self {
        match value {
            "protanopia" => Self::Protanopia,
            "deuteranopia" => Self::Deuteranopia,
            "tritanopia" => Self::Tritanopia,
            _ => Self::Off,
        }
    }
    pub fn valid(value: &str) -> bool {
        matches!(value, "off" | "protanopia" | "deuteranopia" | "tritanopia")
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Target {
    pub profile: Profile,
    /// Strength of the *recolouring*, not the severity of the person's vision.
    pub strength: u32,
    pub paused: bool,
}

impl Target {
    pub const OFF: Self = Self { profile: Profile::Off, strength: 0, paused: false };
    pub fn new(profile: Profile, strength: u32, paused: bool) -> Self {
        Self { profile, strength: strength.min(100), paused }
    }
    pub fn wants_effect(self) -> bool {
        self.profile != Profile::Off && self.strength > 0 && !self.paused
    }
    fn inactive_status(self) -> Status {
        if self.profile != Profile::Off && self.strength > 0 && self.paused { Status::Paused }
        else { Status::Off }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum Status { Off, Pending, Active, Paused, Conflict, Error, RestoreError, Unsupported }

impl Status {
    pub fn from_u8(value: u8) -> Self {
        match value {
            1 => Self::Pending, 2 => Self::Active, 3 => Self::Paused,
            4 => Self::Conflict, 5 => Self::Error, 6 => Self::RestoreError,
            7 => Self::Unsupported, _ => Self::Off,
        }
    }
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Off => "off", Self::Pending => "pending", Self::Active => "active",
            Self::Paused => "paused", Self::Conflict => "conflict", Self::Error => "error",
            Self::RestoreError => "restoreError", Self::Unsupported => "unsupported",
        }
    }
}

// Row-major 3x3 matrices operate on column vectors. The resulting matrix is
// transposed into Win32's input-row/output-column 5x5 representation below.
fn model(profile: Profile) -> Option<([[f32; 3]; 3], [[f32; 3]; 3])> {
    let (sim, shift) = match profile {
        Profile::Off => return None,
        Profile::Protanopia => (
            [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
            [[0.0, 0.0, 0.0], [0.7, 1.0, 0.0], [0.7, 0.0, 1.0]],
        ),
        Profile::Deuteranopia => (
            [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.011820, 0.042940, 0.968881]],
            [[1.0, 0.7, 0.0], [0.0, 0.0, 0.0], [0.0, 0.7, 1.0]],
        ),
        Profile::Tritanopia => (
            [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.303900]],
            [[1.0, 0.0, 0.7], [0.0, 1.0, 0.7], [0.0, 0.0, 0.0]],
        ),
    };
    Some((sim, shift))
}

/// No alpha change, offsets or zoom. Strength 0 and Off are exact identities.
pub fn correction(profile: Profile, strength: u32) -> Matrix {
    let Some((sim, shift)) = model(profile) else { return IDENTITY; };
    let weight = strength.min(100) as f32 / 100.0;
    let mut result = IDENTITY;
    for output in 0..3 {
        for input in 0..3 {
            let mut delta = 0.0;
            for k in 0..3 {
                let identity = if k == input { 1.0 } else { 0.0 };
                delta += shift[output][k] * (identity - sim[k][input]);
            }
            // MAGCOLOREFFECT uses vector * matrix: row=input, column=output.
            result[input][output] += weight * delta;
        }
    }
    result
}

/// The windows 0.58 binding exposes MAGCOLOREFFECT as a flat row-major array,
/// even though the C header describes it as float[5][5]. Do not transpose here.
pub fn pack_matrix(matrix: &Matrix) -> [f32; 25] {
    let mut flat = [0.0; 25];
    for (row, values) in matrix.iter().enumerate() {
        flat[row * 5..row * 5 + 5].copy_from_slice(values);
    }
    flat
}
pub fn unpack_matrix(flat: &[f32; 25]) -> Matrix {
    let mut matrix = [[0.0; 5]; 5];
    for (row, values) in matrix.iter_mut().enumerate() {
        values.copy_from_slice(&flat[row * 5..row * 5 + 5]);
    }
    matrix
}

/// Comparison is only a best-effort ownership check, not an atomic OS lock.
pub fn same_matrix(a: &Matrix, b: &Matrix) -> bool {
    a.iter().flatten().zip(b.iter().flatten()).all(|(x, y)| x.is_finite() && y.is_finite() && (x - y).abs() < 0.00001)
}

/// An intentionally tiny backend makes the actual policy executable on a host
/// without Windows. Real Win32 calls are all made on one dedicated worker.
pub trait Backend {
    fn initialize(&mut self) -> bool;
    fn get(&mut self) -> Option<Matrix>;
    fn set(&mut self, matrix: &Matrix) -> bool;
    /// Avoid explicit teardown if another full-screen zoom is in use or its
    /// state cannot be read. This is still only a best-effort guard.
    fn safe_to_uninitialize(&mut self) -> bool { true }
    fn uninitialize(&mut self) -> bool;
}

pub struct Controller<B: Backend> {
    pub backend: B,
    initialized: bool,
    owned: Option<Matrix>,
    blocked: bool,
    previous: Option<Target>,
}

impl<B: Backend> Controller<B> {
    pub fn new(backend: B) -> Self {
        Self { backend, initialized: false, owned: None, blocked: false, previous: None }
    }

    /// Apply only against identity or our last matrix. If another effect is
    /// detected, never repeatedly fight it; an explicit retry or a changed
    /// selection is required. All get/set checks remain inherently racy.
    pub fn step(&mut self, target: Target, retry: bool) -> Status {
        let changed = self.previous != Some(target);
        self.previous = Some(target);
        if !target.wants_effect() {
            self.blocked = false;
            if let Some(last) = self.owned {
                let Some(current) = self.backend.get() else { return Status::RestoreError; };
                if !same_matrix(&current, &last) {
                    // The last writer is no longer us. Never reset their matrix.
                    self.owned = None;
                } else if !self.backend.set(&IDENTITY) {
                    // Keep ownership so a later inactive step can retry.
                    return Status::RestoreError;
                } else {
                    self.owned = None;
                }
            }
            return target.inactive_status();
        }

        if self.blocked && !changed && !retry { return Status::Conflict; }
        if changed || retry { self.blocked = false; }
        if !self.initialized {
            if !self.backend.initialize() { return Status::Error; }
            self.initialized = true;
        }
        let Some(current) = self.backend.get() else { return Status::Error; };
        if let Some(last) = self.owned {
            if !same_matrix(&current, &last) {
                self.owned = None;
                self.blocked = true;
                return Status::Conflict;
            }
        } else if !same_matrix(&current, &IDENTITY) {
            self.blocked = true;
            return Status::Conflict;
        }
        let next = correction(target.profile, target.strength);
        if self.owned.is_some() && same_matrix(&current, &next) { return Status::Active; }
        if self.backend.set(&next) {
            self.owned = Some(next);
            Status::Active
        } else {
            // Defensive: if the API returned failure after changing the matrix,
            // remember that value so a later disable can still attempt recovery.
            if self.backend.get().is_some_and(|m| same_matrix(&m, &next)) {
                self.owned = Some(next);
            }
            Status::Error
        }
    }

    /// Called on the same worker as initialize/get/set. Avoid explicitly
    /// uninitializing over a newly observed external matrix: Microsoft's sample
    /// notes that MagUninitialize can turn off the current fullscreen effect.
    /// Process termination and races may still interfere; no OS ownership lock
    /// is provided. Return false if our own restoration could not be confirmed.
    pub fn shutdown(&mut self) -> bool {
        let restored = self.step(Target::OFF, false) != Status::RestoreError;
        if self.initialized {
            let current = self.backend.get();
            let safe = current.as_ref().is_some_and(|m| {
                same_matrix(m, &IDENTITY) || self.owned.as_ref().is_some_and(|own| same_matrix(m, own))
            });
            if safe && self.backend.safe_to_uninitialize() {
                let ok = self.backend.uninitialize();
                self.initialized = false;
                return restored && ok;
            }
            // Release process resources at exit rather than actively clearing
            // an external effect or guessing when the read failed.
            return restored && current.is_some();
        }
        restored
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Default)]
    struct Fake {
        current: Option<Matrix>, writes: Vec<Matrix>, inits: usize, uninit: usize,
        fail_init: bool, fail_read: bool, fail_write: bool, zoom_active: bool,
    }
    impl Fake { fn new() -> Self { Self { current: Some(IDENTITY), ..Self::default() } } }
    impl Backend for Fake {
        fn initialize(&mut self) -> bool { self.inits += 1; !self.fail_init }
        fn get(&mut self) -> Option<Matrix> { if self.fail_read { None } else { self.current } }
        fn set(&mut self, value: &Matrix) -> bool {
            self.writes.push(*value);
            if self.fail_write { false } else { self.current = Some(*value); true }
        }
        fn safe_to_uninitialize(&mut self) -> bool { !self.zoom_active }
        fn uninitialize(&mut self) -> bool { self.uninit += 1; true }
    }
    fn target(profile: Profile) -> Target { Target::new(profile, 60, false) }
    fn transform(m: &Matrix, c: [f32; 3]) -> [f32; 3] {
        let mut result = [0.0; 3];
        for out in 0..3 { for input in 0..3 { result[out] += c[input] * m[input][out]; } }
        result
    }
    fn model_distance(profile: Profile, a: [f32; 3], b: [f32; 3], correction_on: bool) -> f32 {
        let sim = model(profile).unwrap().0;
        let matrix = if correction_on { correction(profile, 60) } else { IDENTITY };
        let apply = |x: [f32; 3]| -> [f32; 3] {
            let x = transform(&matrix, x);
            let mut result = [0.0; 3];
            for i in 0..3 { for j in 0..3 { result[i] += sim[i][j] * x[j]; } }
            result
        };
        let a = apply(a); let b = apply(b);
        ((a[0]-b[0]).powi(2) + (a[1]-b[1]).powi(2) + (a[2]-b[2]).powi(2)).sqrt()
    }

    #[test]
    fn identities_bounds_orientation_and_neutral_gray() {
        assert_eq!(correction(Profile::Off, 100), IDENTITY);
        for p in [Profile::Protanopia, Profile::Deuteranopia, Profile::Tritanopia] {
            assert_eq!(correction(p, 0), IDENTITY);
            assert_eq!(correction(p, 500), correction(p, 100));
            let m = correction(p, 60);
            assert!(!same_matrix(&m, &IDENTITY));
            assert_eq!(m[3], IDENTITY[3]); assert_eq!(m[4], IDENTITY[4]);
            for (i, row) in m.iter().enumerate() {
                assert_eq!(row[3], if i == 3 { 1.0 } else { 0.0 });
                assert_eq!(row[4], if i == 4 { 1.0 } else { 0.0 });
            }
            let gray = transform(&m, [0.5; 3]);
            for x in gray { assert!((x - 0.5).abs() < 0.00001); }
        }
        // Protan's red output is unchanged but red contributes to blue; this
        // pins the Win32 transpose, not merely the diagonal of the matrix.
        let m = correction(Profile::Protanopia, 60);
        assert_eq!(m[0][0], 1.0); assert_eq!(m[1][0], 0.0);
        assert!(m[0][2] > 0.3 && m[1][2] < -0.4);
        assert!(!same_matrix(&correction(Profile::Protanopia, 60), &correction(Profile::Deuteranopia, 60)));
        assert!(!same_matrix(&correction(Profile::Deuteranopia, 60), &correction(Profile::Tritanopia, 60)));
    }

    #[test]
    fn windows_flat_binding_preserves_row_major_orientation() {
        let matrix = correction(Profile::Protanopia, 60);
        let flat = pack_matrix(&matrix);
        assert_eq!(flat[2], matrix[0][2]);
        assert_eq!(flat[5], matrix[1][0]);
        assert_ne!(flat[2], flat[5], "transpose errors must not be hidden");
        assert_eq!(flat[18], 1.0); assert_eq!(flat[24], 1.0);
        assert_eq!(unpack_matrix(&flat), matrix);
    }

    #[test]
    fn correction_redistributes_model_error_rather_than_showing_simulation() {
        // These are algebraic sanity checks on a few in-gamut samples, not a
        // clinical result or a claim about the Windows physical pipeline.
        let cases = [
            (Profile::Protanopia, [0.12,0.58,0.75], [0.81,0.49,0.78]),
            (Profile::Deuteranopia, [0.15,0.48,0.70], [0.76,0.24,0.70]),
            (Profile::Tritanopia, [0.76,0.47,0.85], [0.73,0.53,0.60]),
        ];
        for (profile, a, b) in cases {
            assert!(model_distance(profile, a, b, true) > model_distance(profile, a, b, false) * 1.5);
            let (sim, _) = model(profile).unwrap();
            let matrix = correction(profile, 60);
            assert!((matrix[0][0] - sim[0][0]).abs() > 0.01);
        }
    }

    #[test]
    fn change_pause_resume_off_and_no_redundant_writes() {
        let mut c = Controller::new(Fake::new());
        assert_eq!(c.step(Target::OFF, false), Status::Off);
        assert_eq!(c.backend.inits, 0); assert!(c.backend.writes.is_empty());
        let p = target(Profile::Protanopia);
        assert_eq!(c.step(p, false), Status::Active);
        assert_eq!(c.step(p, false), Status::Active);
        assert_eq!(c.backend.writes.len(), 1);
        assert_eq!(c.step(target(Profile::Tritanopia), false), Status::Active);
        let paused = Target::new(Profile::Tritanopia, 60, true);
        assert_eq!(c.step(paused, false), Status::Paused);
        assert!(same_matrix(&c.backend.current.unwrap(), &IDENTITY));
        assert_eq!(c.step(target(Profile::Tritanopia), false), Status::Active);
        assert_eq!(c.step(Target::OFF, false), Status::Off);
        assert!(same_matrix(&c.backend.current.unwrap(), &IDENTITY));
        assert!(c.shutdown()); assert_eq!(c.backend.uninit, 1);
    }

    #[test]
    fn existing_or_later_effect_is_not_overwritten_and_retry_is_explicit() {
        let mut external = IDENTITY; external[0][0] = 0.5;
        let mut c = Controller::new(Fake::new()); c.backend.current = Some(external);
        let p = target(Profile::Deuteranopia);
        assert_eq!(c.step(p, false), Status::Conflict); assert!(c.backend.writes.is_empty());
        c.backend.current = Some(IDENTITY);
        assert_eq!(c.step(p, false), Status::Conflict); assert!(c.backend.writes.is_empty());
        assert_eq!(c.step(p, true), Status::Active);
        c.backend.current = Some(external);
        assert_eq!(c.step(p, false), Status::Conflict);
        let writes = c.backend.writes.len();
        assert_eq!(c.step(Target::OFF, false), Status::Off);
        assert_eq!(c.backend.writes.len(), writes); assert_eq!(c.backend.current.unwrap(), external);
        assert!(c.shutdown()); assert_eq!(c.backend.uninit, 0, "do not explicitly uninitialize over an external effect");
    }

    #[test]
    fn shutdown_does_not_explicitly_uninitialize_over_a_fullscreen_zoom() {
        let mut c = Controller::new(Fake::new());
        assert_eq!(c.step(target(Profile::Protanopia), false), Status::Active);
        c.backend.zoom_active = true;
        assert!(c.shutdown());
        assert!(same_matrix(&c.backend.current.unwrap(), &IDENTITY));
        assert_eq!(c.backend.uninit, 0);
    }

    #[test]
    fn restore_failure_is_reported_and_retried_even_when_switched_off() {
        let mut c = Controller::new(Fake::new());
        assert_eq!(c.step(target(Profile::Tritanopia), false), Status::Active);
        c.backend.fail_write = true;
        assert_eq!(c.step(Target::OFF, false), Status::RestoreError);
        assert!(!same_matrix(&c.backend.current.unwrap(), &IDENTITY));
        c.backend.fail_write = false;
        assert_eq!(c.step(Target::OFF, false), Status::Off);
        assert!(same_matrix(&c.backend.current.unwrap(), &IDENTITY));
    }

    #[test]
    fn errors_never_claim_success_or_reset_an_unknown_effect() {
        let mut c = Controller::new(Fake::new());
        let p = target(Profile::Protanopia);
        c.backend.fail_init = true; assert_eq!(c.step(p, false), Status::Error);
        c.backend.fail_init = false; c.backend.fail_read = true;
        assert_eq!(c.step(p, false), Status::Error); assert!(c.backend.writes.is_empty());
        assert!(!c.shutdown()); assert_eq!(c.backend.uninit, 0);
    }

    #[test]
    fn settings_parse_fail_closed_and_zero_strength_is_off() {
        assert_eq!(Profile::parse("unknown"), Profile::Off);
        assert!(!Profile::valid("unknown")); assert!(Profile::valid("tritanopia"));
        assert_eq!(Target::new(Profile::Tritanopia, 1000, false).strength, 100);
        let mut c = Controller::new(Fake::new());
        assert_eq!(c.step(Target::new(Profile::Tritanopia, 0, false), false), Status::Off);
        assert_eq!(c.step(Target::new(Profile::Tritanopia, 60, true), false), Status::Paused);
        assert_eq!(c.backend.inits, 0); assert!(c.backend.writes.is_empty());
    }
}
