use open_pdf_geos::{
    area_with_hole, contains_point, contains_points, covers_point, crossing_points,
    difference_area, flat_buffer_area, group_net_area, intersection_area, net_area, offset_curve,
    polygonize, ring_area, simplify_line, union_area, AreaShape,
};

fn near(actual: f64, expected: f64, tolerance: f64) {
    assert!(
        (actual - expected).abs() <= tolerance,
        "area {actual} is outside {expected} ± {tolerance}"
    );
}

#[test]
fn unit_square_has_area_one() {
    let square = [(0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0)];
    near(ring_area(&square).unwrap(), 1.0, 1e-9);
}

#[test]
fn half_overlap_of_two_unit_squares_has_union_area_one_and_a_half() {
    let left = [(0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0)];
    let right = [(0.5, 0.0), (1.5, 0.0), (1.5, 1.0), (0.5, 1.0)];
    near(union_area(&left, &right).unwrap(), 1.5, 1e-9);
}

#[test]
fn square_with_a_square_hole_reports_the_net_area() {
    let outer = [(0.0, 0.0), (2.0, 0.0), (2.0, 2.0), (0.0, 2.0)];
    let hole = [(0.5, 0.5), (1.5, 0.5), (1.5, 1.5), (0.5, 1.5)];
    near(area_with_hole(&outer, &hole).unwrap(), 3.0, 1e-9);
}

#[test]
fn flat_corridor_area_matches_width_times_length() {
    let area = flat_buffer_area((0.0, 0.0), (10.0, 0.0), 2.0).unwrap();
    near(area, 20.0, 1e-6);
}

#[test]
fn net_area_subtracts_every_hole_and_counts_an_overlap_once() {
    let outer = vec![(0.0, 0.0), (3.0, 0.0), (3.0, 3.0), (0.0, 3.0)];
    let hole_a = vec![(0.5, 0.5), (1.5, 0.5), (1.5, 1.5), (0.5, 1.5)];
    // 1 by 1, inside the outer square, and clear of the first hole.
    let hole_b = vec![(1.7, 0.5), (2.7, 0.5), (2.7, 1.5), (1.7, 1.5)];
    near(net_area(&[outer], &[hole_a, hole_b]).unwrap(), 7.0, 1e-6);

    let left = vec![(0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0)];
    let right = vec![(0.5, 0.0), (1.5, 0.0), (1.5, 1.0), (0.5, 1.0)];
    near(net_area(&[left, right], &[]).unwrap(), 1.5, 1e-6);
}

fn near_xy(actual: (f64, f64), expected: (f64, f64)) -> bool {
    (actual.0 - expected.0).abs() <= 1e-6 && (actual.1 - expected.1).abs() <= 1e-6
}

fn same_cycle(actual: &[(f64, f64)], expected: &[(f64, f64)]) {
    assert_eq!(actual.len(), expected.len(), "offset {actual:?}");
    let count = expected.len();
    let forward = (0..count).any(|shift| {
        (0..count).all(|index| near_xy(actual[(shift + index) % count], expected[index]))
    });
    let reverse = (0..count).any(|shift| {
        (0..count)
            .all(|index| near_xy(actual[(shift + index) % count], expected[count - 1 - index]))
    });
    assert!(
        forward || reverse,
        "offset {actual:?} is not the ring {expected:?}"
    );
}

#[test]
fn a_self_crossing_ring_reports_both_lobes() {
    // (0,0)-(1,1) crosses (1,0)-(0,1) at (0.5,0.5). The shoelace of the ring
    // is 0. The two triangles each have area 0.25.
    let bowtie = vec![(0.0, 0.0), (1.0, 1.0), (1.0, 0.0), (0.0, 1.0)];
    near(net_area(&[bowtie], &[]).unwrap(), 0.5, 1e-6);
}

#[test]
fn group_net_counts_an_overlap_once_and_keeps_a_hole_until_it_is_filled() {
    let left = shape(&[(0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0)], &[]);
    let right = shape(&[(0.5, 0.0), (1.5, 0.0), (1.5, 1.0), (0.5, 1.0)], &[]);
    near(group_net_area(&[left, right]).unwrap(), 1.5, 1e-6);

    let apart = shape(&[(2.0, 0.0), (3.0, 0.0), (3.0, 1.0), (2.0, 1.0)], &[]);
    let bowtie = shape(&[(0.0, 0.0), (1.0, 1.0), (1.0, 0.0), (0.0, 1.0)], &[]);
    near(group_net_area(&[bowtie, apart]).unwrap(), 1.5, 1e-6);

    let donut = shape(
        &[(0.0, 0.0), (2.0, 0.0), (2.0, 2.0), (0.0, 2.0)],
        &[&[(0.5, 0.5), (1.5, 0.5), (1.5, 1.5), (0.5, 1.5)]],
    );
    near(group_net_area(&[donut]).unwrap(), 3.0, 1e-6);
    let open = shape(
        &[(0.0, 0.0), (2.0, 0.0), (2.0, 2.0), (0.0, 2.0)],
        &[&[(0.5, 0.5), (1.5, 0.5), (1.5, 1.5), (0.5, 1.5)]],
    );
    let plug = shape(&[(0.5, 0.5), (1.5, 0.5), (1.5, 1.5), (0.5, 1.5)], &[]);
    near(group_net_area(&[open, plug]).unwrap(), 4.0, 1e-6);
}

fn shape(outer: &[(f64, f64)], holes: &[&[(f64, f64)]]) -> AreaShape {
    AreaShape {
        parts: vec![outer.to_vec()],
        holes: holes.iter().map(|ring| ring.to_vec()).collect(),
    }
}

#[test]
fn crossing_points_are_only_the_places_two_paths_meet() {
    let horizontal = [(0.0, 1.0), (2.0, 1.0)];
    let vertical = [(1.0, 0.0), (1.0, 2.0)];
    let hit = crossing_points(&horizontal, &vertical).unwrap();
    assert_eq!(hit.len(), 1, "{hit:?}");
    assert!(near_xy(hit[0], (1.0, 1.0)), "{hit:?}");

    let miss = [(0.0, 0.0), (1.0, 0.0)];
    let above = [(0.0, 1.0), (1.0, 1.0)];
    assert!(crossing_points(&miss, &above).unwrap().is_empty());

    let overlap = [(0.0, 0.0), (2.0, 0.0)];
    let along = [(1.0, 0.0), (3.0, 0.0)];
    assert!(
        crossing_points(&overlap, &along).unwrap().is_empty(),
        "a collinear overlap is not a corner"
    );

    let ridge = [(0.0, 0.0), (1.0, 2.0), (2.0, 0.0)];
    let both = crossing_points(&horizontal, &ridge).unwrap();
    assert_eq!(both.len(), 2, "{both:?}");
    assert!(
        both.iter().any(|point| near_xy(*point, (0.5, 1.0)))
            && both.iter().any(|point| near_xy(*point, (1.5, 1.0))),
        "{both:?}"
    );

    let tee = crossing_points(&[(0.0, 0.0), (2.0, 0.0)], &[(1.0, 0.0), (1.0, 1.0)]).unwrap();
    assert_eq!(tee.len(), 1, "{tee:?}");
    assert!(near_xy(tee[0], (1.0, 0.0)), "{tee:?}");
}

#[test]
fn offset_of_a_horizontal_segment_follows_the_page_side() {
    let line = [(0.0, 0.0), (10.0, 0.0)];
    let left = offset_curve(&line, 2.0, 1.0, false).unwrap();
    assert_eq!(left.len(), 2, "{left:?}");
    assert!(
        near_xy(left[0], (0.0, -2.0)) && near_xy(left[1], (10.0, -2.0)),
        "{left:?}"
    );

    let right = offset_curve(&line, 2.0, -1.0, false).unwrap();
    assert_eq!(right.len(), 2, "{right:?}");
    assert!(
        near_xy(right[0], (0.0, 2.0)) && near_xy(right[1], (10.0, 2.0)),
        "{right:?}"
    );
}

#[test]
fn offset_of_a_square_expands_through_the_mitred_corners() {
    let square = [(0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0)];
    let expanded = offset_curve(&square, 1.0, 1.0, true).unwrap();
    same_cycle(
        &expanded,
        &[(-1.0, -1.0), (2.0, -1.0), (2.0, 2.0), (-1.0, 2.0)],
    );

    let inset = offset_curve(&square, 0.25, -1.0, true).unwrap();
    same_cycle(
        &inset,
        &[(0.25, 0.25), (0.75, 0.25), (0.75, 0.75), (0.25, 0.75)],
    );
}

#[test]
fn contains_excludes_the_boundary_and_covers_includes_it() {
    let square = [(0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0)];
    assert!(contains_point(&square, 0.5, 0.5).unwrap());
    assert!(covers_point(&square, 0.5, 0.5).unwrap());
    assert!(!contains_point(&square, 2.0, 2.0).unwrap());
    assert!(!covers_point(&square, 2.0, 2.0).unwrap());
    assert!(!contains_point(&square, 0.0, 0.0).unwrap());
    assert!(covers_point(&square, 0.0, 0.0).unwrap());

    let answers = contains_points(&square, &[(0.5, 0.5), (2.0, 2.0), (0.0, 0.0)]).unwrap();
    assert_eq!(answers, vec![true, false, false]);
}

#[test]
fn simplify_drops_a_collinear_point_and_keeps_square_corners() {
    let line = [(0.0, 0.0), (0.5, 0.0), (1.0, 0.0)];
    assert_eq!(
        simplify_line(&line, 0.0, false).unwrap(),
        vec![(0.0, 0.0), (1.0, 0.0)]
    );
    assert!(simplify_line(&line, -0.1, false).is_err());
    assert!(simplify_line(&[(0.0, 0.0)], 0.0, false).is_err());
    assert!(simplify_line(&[(0.0, 0.0), (1.0, 0.0)], 0.0, true).is_err());

    let square = [(0.0, 0.0), (0.5, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0)];
    let closed = simplify_line(&square, 0.0, true).unwrap();
    assert_ne!(closed.first(), closed.last());
    same_cycle(&closed, &[(0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0)]);
}

#[test]
fn polygonize_unit_square_edges_have_area_one() {
    let lines = vec![
        vec![(0.0, 0.0), (1.0, 0.0)],
        vec![(1.0, 0.0), (1.0, 1.0)],
        vec![(1.0, 1.0), (0.0, 1.0)],
        vec![(0.0, 1.0), (0.0, 0.0)],
    ];
    let faces = polygonize(&lines).unwrap();
    assert_eq!(faces.len(), 1, "{faces:?}");
    near(faces[0].area, 1.0, 1e-9);
    assert!(faces[0].holes.is_empty(), "{faces:?}");
    same_cycle(
        &faces[0].shell,
        &[(0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0)],
    );
    assert!(polygonize(&[vec![(0.0, 0.0), (1.0, 0.0)]])
        .unwrap()
        .is_empty());
}

#[test]
fn half_overlap_intersection_and_difference_are_one_half() {
    let left = [(0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0)];
    let right = [(0.5, 0.0), (1.5, 0.0), (1.5, 1.0), (0.5, 1.0)];
    near(intersection_area(&left, &right).unwrap(), 0.5, 1e-9);
    near(difference_area(&left, &right).unwrap(), 0.5, 1e-9);
}

fn square_edges(x0: f64, y0: f64, x1: f64, y1: f64) -> Vec<Vec<(f64, f64)>> {
    vec![
        vec![(x0, y0), (x1, y0)],
        vec![(x1, y0), (x1, y1)],
        vec![(x1, y1), (x0, y1)],
        vec![(x0, y1), (x0, y0)],
    ]
}

#[test]
fn polygonize_donut_linework_locks_observed_faces() {
    // GEOS 3.14.1 emits both the holed shell and the inner face. They share
    // no area, so the areas sum to the outer square.
    let mut lines = square_edges(0.0, 0.0, 2.0, 2.0);
    lines.extend(square_edges(0.5, 0.5, 1.5, 1.5));
    let faces = polygonize(&lines).unwrap();
    assert_eq!(faces.len(), 2, "{faces:?}");
    near(faces[0].area, 3.0, 1e-9);
    near(faces[1].area, 1.0, 1e-9);
    near(faces[0].area + faces[1].area, 4.0, 1e-9);
    assert_eq!(faces[0].holes.len(), 1, "{faces:?}");
    assert!(faces[1].holes.is_empty(), "{faces:?}");
    let outer = [(0.0, 0.0), (2.0, 0.0), (2.0, 2.0), (0.0, 2.0)];
    let inner = [(0.5, 0.5), (1.5, 0.5), (1.5, 1.5), (0.5, 1.5)];
    same_cycle(&faces[0].shell, &outer);
    same_cycle(&faces[0].holes[0], &inner);
    same_cycle(&faces[1].shell, &inner);
    assert_ne!(faces[0].shell.first(), faces[0].shell.last());
    assert_ne!(faces[1].shell.first(), faces[1].shell.last());
    assert_ne!(faces[0].holes[0].first(), faces[0].holes[0].last());
}
